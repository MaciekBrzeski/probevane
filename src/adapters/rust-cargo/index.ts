import { readFile, readdir, access } from 'node:fs/promises';
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
import { rustAuditRules } from '../../audit/rules-rust.js';
import { loadPrompt } from '../../library/prompt.js';

// rust-cargo — Rust stack via the built-in test harness. Integration tests in
// tests/<name>.rs use the crate's public API. Same StackAdapter contract.
const exists = (p: string) => access(p).then(() => true).catch(() => false);

export const rustAdapter: StackAdapter = {
  id: 'rust-cargo',

  async detect(dir: string): Promise<number> {
    let score = 0;
    if (await exists(join(dir, 'Cargo.toml'))) score += 0.7;
    if (await exists(join(dir, 'src/lib.rs')) || await exists(join(dir, 'src/main.rs'))) score += 0.2;
    return Math.min(score, 1);
  },

  async install(dir: string): Promise<void> {
    await sh('cargo fetch', dir, 120_000);
  },

  async discover(dir: string, _kind: TestKind): Promise<TestTarget[]> {
    // The crate root (lib.rs) is the unit-test target; integration tests go in tests/.
    const root = (await exists(join(dir, 'src/lib.rs'))) ? 'src/lib.rs' : 'src/main.rs';
    return [{ kind: 'unit', sourcePath: root, name: 'lib' }];
  },

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    const src = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
    const crate = await crateName(dir);
    const fns = [...src.matchAll(/pub\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[^{]+)?/g)].map(
      (m) => `${m[1]}(${m[2].trim()})${m[3] ? ' ' + m[3].trim() : ''}`,
    );
    const lines = [`GROUND TRUTH for ${target.sourcePath} (crate \`${crate}\`):`];
    if (fns.length) lines.push(`- pub fns: ${fns.join('; ')}`);
    lines.push(
      `- write an integration test at tests/<name>.rs: \`use ${crate}::*;\` then #[test] fns with assert_eq!/assert!.`,
    );
    const ok = fns.length > 0;
    return { target, facts: { crate, fns }, digest: lines.join('\n'), ok, error: ok ? undefined : 'no pub fns' };
  },

  async run(dir: string, _scope: RunScope, _files?: string[]): Promise<RunResult> {
    const r = await sh('cargo test --quiet', dir, 180_000);
    let passed = 0, failed = 0;
    for (const m of (r.stdout + r.stderr).matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) {
      passed += parseInt(m[1], 10);
      failed += parseInt(m[2], 10);
    }
    return {
      passed,
      failed,
      skipped: 0,
      green: r.ok && failed === 0 && passed > 0,
      raw: (r.stdout + r.stderr).slice(-4000),
    };
  },

  async coverage(dir: string): Promise<CoverageResult> {
    // Real coverage when cargo-llvm-cov is installed; n/a otherwise
    // (`cargo install cargo-llvm-cov` to enable — not assumed on CI runners).
    const probe = await sh('cargo llvm-cov --version', dir);
    if (!probe.ok) return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false };
    const r = await sh('cargo llvm-cov --json --summary-only --quiet', dir, 300_000);
    if (!r.ok) return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false, raw: r.stderr.slice(-1500) };
    return parseLlvmCovSummary(r.stdout);
  },

  async specFiles(dir: string): Promise<string[]> {
    const t = join(dir, 'tests');
    const files = await readdir(t).catch(() => []);
    return files.filter((f) => f.endsWith('.rs')).map((f) => join('tests', f));
  },

  guidance(_kind: TestKind): string {
    return `(Rust, cargo test) write an INTEGRATION test in tests/<name>.rs: \`use <crate>::*;\` then #[test] functions asserting with assert_eq!/assert!. Cover happy paths + error/Result paths. Use only the pub fns in the ground truth.`;
  },
  patternsDoc(_kind: TestKind): Promise<string> {
    return loadPrompt('rust-unit-patterns.md');
  },
  auditRules(): AuditRule[] {
    return rustAuditRules();
  },
  commands(): AdapterCommands {
    return {
      typecheck: 'cargo build --quiet',
      lint: 'cargo fmt --check || true',
      testUnit: 'cargo test --quiet',
      testE2e: 'true',
      coverage: 'true',
    };
  },
};

/** Parse `cargo llvm-cov --json --summary-only` output into a CoverageResult. */
export function parseLlvmCovSummary(jsonText: string): CoverageResult {
  try {
    const j = JSON.parse(jsonText);
    const t = j.data?.[0]?.totals;
    if (!t) throw new Error('no totals');
    const pct = (k: string) => Math.round((t[k]?.percent ?? 0) * 100) / 100;
    return {
      statements: pct('regions'),
      branches: pct('branches'),
      functions: pct('functions'),
      lines: pct('lines'),
      ok: true,
    };
  } catch {
    return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false };
  }
}

async function crateName(dir: string): Promise<string> {
  const toml = await readFile(join(dir, 'Cargo.toml'), 'utf8').catch(() => '');
  return (toml.match(/name\s*=\s*"([^"]+)"/)?.[1] ?? 'crate').replace(/-/g, '_');
}
