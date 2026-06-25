import { readdir, readFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  StackAdapter,
  TestKind,
  TestTarget,
  ProbeResult,
  RunScope,
  RunResult,
  CoverageResult,
  AdapterCommands,
  AuditRule,
} from '../adapter.js';
import { sh } from '../../util/exec.js';
import { goAuditRules } from '../../audit/rules-go.js';
import { loadPrompt } from '../../library/prompt.js';

// go-test — Go stack via the stdlib `testing` package + table tests. Implements
// the same StackAdapter contract; reuses the loop/audit/eval unchanged.
const exists = (p: string) => access(p).then(() => true).catch(() => false);

export const goAdapter: StackAdapter = {
  id: 'go-test',

  async detect(dir: string): Promise<number> {
    let score = 0;
    if (await exists(join(dir, 'go.mod'))) score += 0.6;
    try {
      if ((await walk(dir)).some((f) => f.endsWith('.go'))) score += 0.3;
    } catch {
      /* ignore */
    }
    return Math.min(score, 1);
  },

  async install(dir: string): Promise<void> {
    await sh('go mod tidy', dir, 120_000); // stdlib testing — no test deps
  },

  async discover(dir: string, _kind: TestKind): Promise<TestTarget[]> {
    const files = (await walk(dir)).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
    return files.map((f) => ({ kind: 'unit', sourcePath: relative(dir, f), name: f.split('/').pop()!.replace(/\.go$/, '') }));
  },

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    const src = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
    const pkg = src.match(/^package\s+(\w+)/m)?.[1] ?? '';
    const fns = [...src.matchAll(/^func\s+([A-Z]\w*)\s*\(([^)]*)\)\s*([^{]*)\{/gm)].map(
      (m) => `${m[1]}(${m[2].trim()})${m[3].trim() ? ' ' + m[3].trim() : ''}`,
    );
    const types = [...src.matchAll(/^type\s+([A-Z]\w*)\s+struct/gm)].map((m) => m[1]);
    const lines = [`GROUND TRUTH for ${target.sourcePath} (package ${pkg}):`];
    if (fns.length) lines.push(`- exported funcs: ${fns.join('; ')}`);
    if (types.length) lines.push(`- exported types: ${types.join(', ')}`);
    lines.push('- table-driven test in the SAME package, file <name>_test.go; assert with t.Errorf/t.Fatalf.');
    const ok = fns.length > 0;
    return { target, facts: { pkg, fns }, digest: lines.join('\n'), ok, error: ok ? undefined : 'no exported funcs' };
  },

  async run(dir: string, _scope: RunScope, _files?: string[]): Promise<RunResult> {
    const r = await sh('go test -json -count=1 ./...', dir, 120_000);
    let passed = 0, failed = 0, skipped = 0;
    for (const line of r.stdout.split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const e = JSON.parse(line);
        if (!e.Test) continue;
        if (e.Action === 'pass') passed++;
        else if (e.Action === 'fail') failed++;
        else if (e.Action === 'skip') skipped++;
      } catch {
        /* ignore */
      }
    }
    const total = passed + failed + skipped;
    return { passed, failed, skipped, green: r.ok && failed === 0 && total > 0 && passed > 0, raw: (r.stdout + r.stderr).slice(-4000) };
  },

  async coverage(dir: string): Promise<CoverageResult> {
    const r = await sh('go test -coverprofile=.probevane-cover.out -count=1 ./... && go tool cover -func=.probevane-cover.out', dir, 120_000);
    const m = r.stdout.match(/total:\s+\(statements\)\s+([\d.]+)%/);
    const pct = m ? parseFloat(m[1]) : 0;
    return { statements: pct, branches: 0, functions: pct, lines: pct, ok: !!m, raw: r.stdout.slice(-1500) };
  },

  async specFiles(dir: string): Promise<string[]> {
    return (await walk(dir)).filter((f) => f.endsWith('_test.go')).map((f) => relative(dir, f));
  },

  guidance(_kind: TestKind): string {
    return `(Go stdlib testing) one <name>_test.go per source file, SAME package. Use table-driven tests: a slice of cases struct, loop with t.Run(name, ...), assert with t.Errorf/t.Fatalf. Test error paths too. Use ONLY exported funcs in the ground truth.`;
  },

  patternsDoc(_kind: TestKind): Promise<string> {
    return loadPrompt('go-unit-patterns.md');
  },

  auditRules(): AuditRule[] {
    return goAuditRules();
  },

  commands(): AdapterCommands {
    return { typecheck: 'go build ./...', lint: 'gofmt -l . || true', testUnit: 'go test ./...', testE2e: 'true', coverage: 'go test -cover ./...' };
  },
};

async function walk(dir: string, sub = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(dir, sub), { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (['.git', 'vendor', 'node_modules'].includes(e.name)) continue;
      out.push(...(await walk(dir, join(sub, e.name))));
    } else out.push(join(dir, sub, e.name));
  }
  return out;
}
