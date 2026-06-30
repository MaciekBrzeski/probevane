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
import { pyAuditRules } from '../../audit/rules-py.js';
import { loadPrompt } from '../../library/prompt.js';

// python-pytest — second first-class stack. Proves modularity: it implements
// the SAME StackAdapter contract; loop/library/eval/gates are untouched.
// Resolves a python interpreter from PROBEVANE_PY, a local .venv, else python3.

const SKIP = ['__pycache__', '.venv', 'venv', '.git', 'node_modules', 'dist', 'build'];

async function exists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

async function pyBin(dir: string): Promise<string> {
  if (process.env.PROBEVANE_PY) return process.env.PROBEVANE_PY;
  const venv = join(dir, '.venv', 'bin', 'python');
  if (await exists(venv)) return venv;
  return 'python3';
}

export const pythonAdapter: StackAdapter = {
  id: 'python-pytest',

  async detect(dir: string): Promise<number> {
    let score = 0;
    if (await exists(join(dir, 'pyproject.toml'))) score += 0.5;
    if (await exists(join(dir, 'requirements.txt'))) score += 0.3;
    try {
      const entries = await readdir(dir);
      if (entries.some((e) => e.endsWith('.py'))) score += 0.3;
    } catch {
      /* ignore */
    }
    return Math.min(score, 1);
  },

  async install(dir: string): Promise<void> {
    const py = await pyBin(dir);
    // Idempotent-ish: only install if pytest missing for this interpreter.
    const has = await sh(`${py} -c "import pytest"`, dir);
    if (!has.ok) {
      const r = await sh(`${py} -m pip install pytest pytest-cov`, dir, 300_000);
      if (!r.ok) throw new Error(`probevane: pip install failed\n${r.stderr.slice(-1500)}`);
    }
  },

  async discover(dir: string, _kind: TestKind): Promise<TestTarget[]> {
    const files = await walk(dir, dir);
    return files
      .filter((f) => f.endsWith('.py'))
      .filter((f) => !/(^|\/)(test_|conftest)/.test(f) && !/_test\.py$/.test(f))
      .map((f) => ({ kind: 'unit' as TestKind, sourcePath: f, name: f.replace(/\.py$/, '').replace(/\//g, '.') }));
  },

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    let src: string;
    try {
      src = await readFile(join(dir, target.sourcePath), 'utf8');
    } catch (e) {
      return { target, facts: {}, digest: '', ok: false, error: `cannot read ${target.sourcePath}: ${e}` };
    }
    const funcs = [...src.matchAll(/^def\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)/gm)].map((m) => `${m[1]}(${m[2].trim()})`);
    const classes = [...src.matchAll(/^class\s+([A-Z]\w*)/gm)].map((m) => m[1]);
    const raises = [...src.matchAll(/raise\s+(\w+)/g)].map((m) => m[1]);
    const mod = target.sourcePath.replace(/\.py$/, '').replace(/\//g, '.');
    const lines = [`GROUND TRUTH for ${target.sourcePath} (import from "${mod}"):`];
    if (funcs.length) lines.push(`- functions: ${funcs.join('; ')}`);
    if (classes.length) lines.push(`- classes: ${classes.join(', ')}`);
    if (raises.length) lines.push(`- raises: ${[...new Set(raises)].join(', ')} (test with pytest.raises)`);
    const ok = funcs.length + classes.length > 0;
    return {
      target,
      facts: { funcs, classes, raises },
      digest: lines.join('\n'),
      ok,
      error: ok ? undefined : 'no defs found',
    };
  },

  async run(dir: string, _scope: RunScope, files?: string[]): Promise<RunResult> {
    const py = await pyBin(dir);
    // JUnit XML gives reliable counts regardless of -q / addopts (text summary
    // is suppressed under double-quiet) — the pytest analog of vitest --json.
    const xml = '.probevane-pytest.xml';
    const scoped = files?.length ? ' ' + files.map((f) => JSON.stringify(f)).join(' ') : '';
    const r = await sh(`${py} -m pytest --junit-xml=${xml} -o addopts=${scoped}`, dir);
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    try {
      const x = await readFile(join(dir, xml), 'utf8');
      const m = x.match(/<testsuite\b[^>]*>/);
      const attr = (n: string) => intMatch(m?.[0] ?? '', new RegExp(`${n}="(\\d+)"`));
      const tests = attr('tests');
      failed = attr('failures') + attr('errors');
      skipped = attr('skipped');
      passed = tests - failed - skipped;
    } catch {
      failed = r.ok ? 0 : 1;
    }
    const total = passed + failed + skipped;
    return {
      passed,
      failed,
      skipped,
      green: r.ok && failed === 0 && total > 0 && passed > 0,
      raw: (r.stdout + r.stderr).slice(-4000),
    };
  },

  async coverage(dir: string): Promise<CoverageResult> {
    const py = await pyBin(dir);
    const r = await sh(`${py} -m pytest --cov=. --cov-report=json -q`, dir);
    try {
      const j = JSON.parse(await readFile(join(dir, 'coverage.json'), 'utf8'));
      const pct = j.totals?.percent_covered ?? 0;
      return {
        statements: Math.round(pct * 100) / 100,
        branches: 0,
        functions: 0,
        lines: Math.round(pct * 100) / 100,
        ok: true,
        raw: r.stdout.slice(-1500),
      };
    } catch {
      return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false, raw: (r.stdout + r.stderr).slice(-1500) };
    }
  },

  async specFiles(dir: string): Promise<string[]> {
    const files = await walk(dir, dir);
    return files.filter((f) => /(^|\/)test_\w+\.py$/.test(f) || /_test\.py$/.test(f));
  },

  guidance(_kind: TestKind): string {
    return `(pytest) placed as test_<module>.py next to the source. Import the functions under test from their module, cover happy paths, edge cases, and error paths with pytest.raises. Use plain \`assert\`. Use ONLY functions/classes listed in the ground truth.`;
  },

  patternsDoc(_kind: TestKind): Promise<string> {
    return loadPrompt('py-unit-patterns.md');
  },

  auditRules(): AuditRule[] {
    return pyAuditRules();
  },

  commands(): AdapterCommands {
    // pyBin can't be resolved synchronously; commands use python3 + a .venv hint
    // via the PROBEVANE_PY env when set. validation_gate uses adapter.run anyway.
    const py = process.env.PROBEVANE_PY ?? 'python3';
    return {
      typecheck: 'true', // mypy optional; don't block test-adding
      lint: 'true',
      testUnit: `${py} -m pytest -q`,
      testE2e: 'true',
      coverage: `${py} -m pytest --cov=. --cov-report=json -q`,
    };
  },
};

function intMatch(s: string, re: RegExp): number {
  const m = s.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

async function walk(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP.includes(e.name)) continue;
      out.push(...(await walk(root, join(dir, e.name))));
    } else {
      out.push(relative(root, join(dir, e.name)));
    }
  }
  return out;
}
