import { readFile, readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { StackAdapter } from '../adapters/adapter.js';
import { sh } from '../util/exec.js';

// probevane doctor — health checks distilled from real field failures. Each
// check DETECTS a class of issue that silently degrades the harness or the
// project, and where safe, knows how to FIX it. Pure detectors: every check
// returns findings; the CLI decides whether to apply fixes (--fix).
//
// Provenance (all hit for real before becoming checks):
// - toolchain: py-calc eval failed for days — system python lost pytest and
//   PEP 668 blocked pip; nothing surfaced it as an environment problem.
// - coverage-blindspot: a 534-LOC daemon was invisible to the coverage gate
//   (never imported by tests → absent from the denominator), so 0% read as ok.
// - tracked-artifacts: committed coverage.json/.coverage made every eval run
//   dirty the tree, hiding real diffs.
// - pkg-manifest: package.json "files" listed a README that didn't exist —
//   silent until publish.
// - ci-swallow: `npm install || true` in workflows let a broken fixture
//   install pass CI.
// - stale-cassette: replay cassettes drifted against prompt changes; the only
//   symptom was a cryptic per-request miss.

export type DoctorSeverity = 'error' | 'warn';

export interface DoctorFinding {
  check: string;
  severity: DoctorSeverity;
  message: string;
  /** Set when --fix can resolve this automatically. */
  fixable?: boolean;
  /** Exact remediation for the human when not auto-fixable (or after --fix). */
  hint?: string;
}

export interface DoctorFix {
  finding: DoctorFinding;
  apply: () => Promise<string>; // returns a one-line "what happened"
}

export interface DoctorReport {
  findings: DoctorFinding[];
  fixes: DoctorFix[];
}

const exists = (p: string) => access(p).then(() => true).catch(() => false);

/** Generated-artifact names that must never be git-tracked (evals dirty the tree otherwise). */
const ARTIFACT_PATTERNS = [
  /(^|\/)coverage\.json$/,
  /(^|\/)\.coverage$/,
  /(^|\/)\.probevane-[\w.-]+\.(json|xml)$/,
  /(^|\/)test-results\//,
  /(^|\/)playwright-report\//,
  /\.py[co]$/,
];

/** 1. Toolchain: can the detected adapter actually run tests here? */
export async function checkToolchain(dir: string, adapter: StackAdapter): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const fixes: DoctorFix[] = [];
  // Cheap dry probe: a run with zero targeted files must at least start the
  // runner. A toolchain hole shows up as a non-green run with 0 tests + a
  // runner-level error, which install() can usually repair (venv, deps).
  const specs = await adapter.specFiles(dir).catch(() => []);
  if (!specs.length) return { findings, fixes }; // nothing to run — generate's job, not doctor's
  const r = await adapter.run(dir, 'unit', specs.slice(0, 1)).catch((e) => ({ green: false, passed: 0, failed: 0, skipped: 0, raw: String(e) }));
  if (!r.green && r.passed === 0) {
    const f: DoctorFinding = {
      check: 'toolchain',
      severity: 'error',
      message: `suite cannot run (${adapter.id}): ${lastLine(r.raw)}`,
      fixable: true,
      hint: 'adapter.install() bootstraps the toolchain (e.g. a python .venv on PEP-668 hosts)',
    };
    findings.push(f);
    fixes.push({
      finding: f,
      apply: async () => {
        await adapter.install(dir);
        const again = await adapter.run(dir, 'unit', specs.slice(0, 1));
        return again.green || again.passed > 0
          ? 'toolchain repaired — suite runs'
          : `install ran but the suite is still red: ${lastLine(again.raw)}`;
      },
    });
  }
  return { findings, fixes };
}

/**
 * 2. Coverage blind spots: source files absent from the coverage report
 * entirely. Deliberate excludes from the vitest config are respected — the
 * finding is about files that escape the gate WITHOUT anyone deciding so.
 */
export async function checkCoverageBlindspots(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const summaryPath = join(dir, 'coverage', 'coverage-summary.json');
  if (!(await exists(summaryPath))) return { findings, fixes: [] }; // no report → nothing to compare
  let covered: Set<string>;
  try {
    const j = JSON.parse(await readFile(summaryPath, 'utf8'));
    covered = new Set(Object.keys(j).filter((k) => k !== 'total').map((k) => relative(dir, k)));
  } catch {
    return { findings, fixes: [] };
  }
  const src = join(dir, 'src');
  if (!(await exists(src))) return { findings, fixes: [] };
  const excluded = await coverageExcludes(dir);
  const missing: string[] = [];
  for (const f of await walkSrc(src, src)) {
    const rel = join('src', f);
    if (!/\.[tj]sx?$/.test(rel) || /\.(test|spec|d)\.[tj]sx?$/.test(rel)) continue;
    if (excluded.some((re) => re.test(rel))) continue; // deliberate, justified exclude
    if (!covered.has(rel)) missing.push(rel);
  }
  if (missing.length) {
    findings.push({
      check: 'coverage-blindspot',
      severity: 'error',
      message: `${missing.length} source file(s) absent from the coverage report — never loaded by any test, invisible to the coverage gate: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}`,
      hint: 'these files silently escape the floor; add tests (probevane generate) or an explicit justified exclude',
    });
  }
  return { findings, fixes: [] };
}

/** 3. package.json "files" entries that don't exist on disk (publish bug). */
export async function checkPkgManifest(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  let pkg: { files?: string[] };
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  } catch {
    return { findings, fixes: [] };
  }
  const scripts = (pkg as { scripts?: Record<string, string> }).scripts ?? {};
  const hasBuild = Boolean(scripts.build || scripts.prepublishOnly || scripts.prepack);
  for (const entry of pkg.files ?? []) {
    if (await exists(join(dir, entry.replace(/\/$/, '')))) continue;
    // Build outputs (dist/ etc.) are legitimately absent in a checkout when a
    // build/prepublish script produces them at pack time.
    if (hasBuild && /^(dist|build|lib|out)\/?$/.test(entry)) continue;
    findings.push({
      check: 'pkg-manifest',
      severity: 'error',
      message: `package.json "files" lists "${entry}" but it does not exist — npm publish would silently ship without it`,
      hint: `create ${entry} or drop it from "files"`,
    });
  }
  return { findings, fixes: [] };
}

/** 4. Git-tracked generated artifacts (test-runner/coverage output). */
export async function checkTrackedArtifacts(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const fixes: DoctorFix[] = [];
  const ls = await sh('git ls-files', dir).catch(() => ({ ok: false, stdout: '' }));
  if (!ls.ok) return { findings, fixes };
  const tracked = ls.stdout.split('\n').filter(Boolean);
  const bad = tracked.filter((f) => ARTIFACT_PATTERNS.some((re) => re.test(f)));
  if (bad.length) {
    const f: DoctorFinding = {
      check: 'tracked-artifacts',
      severity: 'warn',
      message: `${bad.length} generated artifact(s) are git-tracked — every test/eval run dirties the tree: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ` (+${bad.length - 5} more)` : ''}`,
      fixable: true,
      hint: 'untrack (git rm --cached) + gitignore them',
    };
    findings.push(f);
    fixes.push({
      finding: f,
      apply: async () => {
        const quoted = bad.map((b) => JSON.stringify(b)).join(' ');
        const rm = await sh(`git rm --cached -q -- ${quoted}`, dir);
        if (!rm.ok) return `git rm --cached failed: ${lastLine(rm.stdout + rm.stderr)}`;
        // Directory-level pattern for __pycache__ (filenames bake in the
        // python version); exact basename for everything else.
        const names = [...new Set(bad.map((b) =>
          b.includes('__pycache__/') ? '**/__pycache__/' : `**/${b.split('/').pop()!}`,
        ))];
        const { appendFile } = await import('node:fs/promises');
        await appendFile(join(dir, '.gitignore'), '\n# generated test artifacts (probevane doctor)\n' + names.join('\n') + '\n');
        return `untracked ${bad.length} artifact(s) + appended .gitignore (staged — review and commit)`;
      },
    });
  }
  return { findings, fixes };
}

/** 5. CI workflow steps that swallow failures on install/test commands. */
export async function checkCiSwallow(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const wfDir = join(dir, '.github', 'workflows');
  const files = (await readdir(wfDir).catch(() => [] as string[])).filter((f) => /\.ya?ml$/.test(f));
  for (const f of files) {
    const txt = await readFile(join(wfDir, f), 'utf8').catch(() => '');
    txt.split('\n').forEach((line, i) => {
      // `|| true` (or `|| echo …`) after install/test/build commands hides real
      // failures. Strip the YAML step key first — `- run:` must not itself
      // trip the keyword match.
      const cmd = line.replace(/^\s*-?\s*run:\s*/, '');
      if (/\|\|\s*(true|echo\b)/.test(cmd) && /\b(install|test|build)\b/.test(cmd)) {
        findings.push({
          check: 'ci-swallow',
          severity: 'warn',
          message: `${f}:${i + 1} swallows failures: ${line.trim().slice(0, 90)}`,
          hint: 'guard with an if-condition instead of || true so real breakage fails the job',
        });
      }
    });
  }
  return { findings, fixes: [] };
}

/** 6. Stale replay cassettes — replay left behind .miss.json dumps. */
export async function checkStaleCassettes(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const cassDir = join(dir, 'eval', 'cassettes');
  const files = (await readdir(cassDir).catch(() => [] as string[])).filter((f) => f.endsWith('.miss.json'));
  for (const f of files) {
    findings.push({
      check: 'stale-cassette',
      severity: 'warn',
      message: `eval/cassettes/${f} — a replay request missed its cassette (recorded prompts drifted from the current ones)`,
      hint: 're-record for $0: probevane eval --paths --live --record --model bridge (then delete the .miss.json)',
    });
  }
  return { findings, fixes: [] };
}

/** Run every check; adapter is optional (repo-only checks still run without one). */
export async function runDoctor(dir: string, adapter?: StackAdapter): Promise<DoctorReport> {
  const parts = await Promise.all([
    adapter ? checkToolchain(dir, adapter) : { findings: [], fixes: [] },
    checkCoverageBlindspots(dir),
    checkPkgManifest(dir),
    checkTrackedArtifacts(dir),
    checkCiSwallow(dir),
    checkStaleCassettes(dir),
  ]);
  return {
    findings: parts.flatMap((p) => p.findings),
    fixes: parts.flatMap((p) => p.fixes),
  };
}

/**
 * Tolerant extraction of coverage exclude globs from a vitest config — a
 * regex scan for the quoted strings of the `exclude: [...]` array, converted
 * to path regexes. No TS evaluation; a missing/odd config just excludes nothing.
 */
async function coverageExcludes(dir: string): Promise<RegExp[]> {
  for (const name of ['vitest.config.mts', 'vitest.config.ts', 'vitest.config.js', 'vite.config.ts']) {
    const txt = await readFile(join(dir, name), 'utf8').catch(() => '');
    if (!txt) continue;
    const m = txt.match(/exclude:\s*\[([\s\S]*?)\]/);
    if (!m) return [];
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, glob]) => globToRe(glob));
  }
  return [];
}

function globToRe(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*');
  return new RegExp(`^${re}$`);
}

function lastLine(s: string | undefined): string {
  const lines = (s ?? '').trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, 160);
}

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '__pycache__', '.venv']);
async function walkSrc(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) out.push(...(await walkSrc(root, join(dir, e.name))));
    } else {
      out.push(relative(root, join(dir, e.name)));
    }
  }
  return out;
}
