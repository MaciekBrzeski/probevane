import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../../util/exec.js';
import { exists, lastLine, walkSrc, type DoctorFinding, type DoctorFix, type DoctorReport } from './shared.js';

// Doctor checks 7-12 — setup/config/eval-consistency lane (see checks.ts for
// the provenance rule: every check generalizes an issue that bit for real).

/** 7. node_modules missing while package.json declares deps. */
export async function checkNodeModules(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const fixes: DoctorFix[] = [];
  let pkg: { dependencies?: object; devDependencies?: object };
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  } catch {
    return { findings, fixes };
  }
  const hasDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  if (!hasDeps || (await exists(join(dir, 'node_modules')))) return { findings, fixes };
  const hasLock = await exists(join(dir, 'package-lock.json'));
  const f: DoctorFinding = {
    check: 'node-modules',
    severity: 'error',
    message: 'package.json declares dependencies but node_modules is absent — every runner invocation will fail',
    fixable: true,
    hint: hasLock ? 'npm ci' : 'npm install',
  };
  findings.push(f);
  fixes.push({
    finding: f,
    apply: async () => {
      const r = await sh(`${hasLock ? 'npm ci' : 'npm install'} --no-fund --no-audit`, dir, 600_000);
      return r.ok ? 'dependencies installed' : `install failed: ${lastLine(r.stderr)}`;
    },
  });
  return { findings, fixes };
}

/** 8. Playwright configured but its browsers were never installed. */
export async function checkPlaywrightBrowsers(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const fixes: DoctorFix[] = [];
  const hasConfig =
    (await exists(join(dir, 'playwright.config.ts'))) || (await exists(join(dir, 'playwright.config.mts')));
  if (!hasConfig) return { findings, fixes };
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? join(process.env.HOME ?? '~', '.cache', 'ms-playwright');
  const entries = await readdir(cache).catch(() => [] as string[]);
  if (entries.some((e) => /^(chromium|firefox|webkit)-/.test(e))) return { findings, fixes };
  const f: DoctorFinding = {
    check: 'playwright-browsers',
    severity: 'error',
    message: 'playwright.config found but no browsers in the Playwright cache — e2e will die with a cryptic launch error',
    fixable: true,
    hint: 'npx playwright install chromium',
  };
  findings.push(f);
  fixes.push({
    finding: f,
    apply: async () => {
      const r = await sh('npx playwright install chromium', dir, 600_000);
      return r.ok ? 'chromium installed' : `playwright install failed: ${lastLine(r.stderr)}`;
    },
  });
  return { findings, fixes };
}

/** 9. probevane.config.* present but schema-invalid (errors otherwise surface mid-run). */
export async function checkConfig(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const names = ['probevane.config.ts', 'probevane.config.js', 'probevane.config.mjs', 'probevane.config.json'];
  for (const name of names) {
    const file = join(dir, name);
    if (!(await exists(file))) continue;
    let cfg: unknown;
    try {
      if (name.endsWith('.json')) cfg = JSON.parse(await readFile(file, 'utf8'));
      else {
        const { pathToFileURL } = await import('node:url');
        const mod = await import(pathToFileURL(file).href);
        cfg = mod.default ?? mod.config ?? mod;
      }
    } catch (e) {
      findings.push({
        check: 'config-invalid',
        severity: 'error',
        message: `${name} failed to load: ${String(e).slice(0, 140)}`,
        hint: 'fix the config before running the loop — every command reads it',
      });
      break;
    }
    const { validateConfig } = await import('../../util/config.js');
    for (const err of validateConfig(cfg)) {
      findings.push({
        check: 'config-invalid',
        severity: 'error',
        message: `${name}: ${err}`,
        hint: 'schema is ProbevaneConfig (src/config.ts) — flag > config > default',
      });
    }
    break; // first config found wins, same as loadConfig
  }
  return { findings, fixes: [] };
}

/** 10. Live-mode credentials: warn when API-key modes are unavailable. */
export async function checkCredentials(_dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  if (!process.env.ANTHROPIC_API_KEY) {
    findings.push({
      check: 'credentials',
      severity: 'warn',
      message: 'ANTHROPIC_API_KEY not set — live generation/eval --live/--record will fail at the first request',
      hint: '$0 modes still work: --model bridge (host-serviced), replay:<cassette>, ollama',
    });
  }
  return { findings, fixes: [] };
}

/**
 * 11. Eval bijection (self-repo only): every case needs a fixture + baseline,
 * every fixture/baseline should belong to a case, and every registered adapter
 * should have at least one fixture exercising it (the node-calc gap class).
 */
export async function checkEvalBijection(dir: string): Promise<DoctorReport> {
  const casesPath = join(dir, 'eval', 'cases.jsonl');
  if (!(await exists(casesPath))) return { findings: [], fixes: [] };
  const cases = (await readFile(casesPath, 'utf8')).trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { fixture: string; kind: string });
  const fixtures = new Set(await readdir(join(dir, 'fixtures')).catch(() => [] as string[]));
  const baselines = new Set(await readdir(join(dir, 'eval', 'baseline')).catch(() => [] as string[]));
  const findings = [
    ...triangleFindings(cases, fixtures, baselines),
    ...(await adapterFixtureFindings(dir, fixtures)),
  ];
  return { findings, fixes: [] };
}

const bij = (severity: 'error' | 'warn', message: string, hint?: string): DoctorFinding =>
  ({ check: 'eval-bijection', severity, message, hint });

/** case ↔ fixture ↔ baseline triangle: cases must resolve; strays are warned. */
function triangleFindings(
  cases: { fixture: string; kind: string }[],
  fixtures: Set<string>,
  baselines: Set<string>,
): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const caseKeys = new Set(cases.map((c) => `${c.fixture}.${c.kind}`));
  for (const c of cases) {
    if (!fixtures.has(c.fixture))
      out.push(bij('error', `case ${c.fixture}.${c.kind} has no fixtures/${c.fixture}/ — eval will crash on it`));
    if (!baselines.has(`${c.fixture}.${c.kind}.json`))
      out.push(bij('error', `case ${c.fixture}.${c.kind} has no eval/baseline/${c.fixture}.${c.kind}.json — eval will crash on it`));
  }
  for (const f of fixtures) {
    if (!cases.some((c) => c.fixture === f))
      out.push(bij('warn', `fixtures/${f}/ has no eval case — regressions there pass CI silently`,
        `append {"fixture":"${f}","kind":"unit"} to eval/cases.jsonl + a measured baseline`));
  }
  for (const b of baselines) {
    const key = b.replace(/\.json$/, '');
    // Path baselines (fixture.refactor/feature/repair) belong to path-cases, not cases.jsonl.
    if (/\.(refactor|feature|repair)$/.test(key)) continue;
    if (!caseKeys.has(key)) out.push(bij('warn', `eval/baseline/${b} is orphaned — no case references it`));
  }
  return out;
}

/** Every registered adapter should own ≥1 fixture (the node-calc gap class). */
async function adapterFixtureFindings(dir: string, fixtures: Set<string>): Promise<DoctorFinding[]> {
  const { ADAPTERS } = await import('../../adapters/registry.js');
  const ownedIds = new Set<string>();
  for (const f of fixtures) {
    const scores = await Promise.all(
      ADAPTERS.map(async (a) => [a.id, await a.detect(join(dir, 'fixtures', f)).catch(() => 0)] as const),
    );
    const best = scores.sort((x, y) => y[1] - x[1])[0];
    if (best && best[1] > 0) ownedIds.add(best[0]);
  }
  return ADAPTERS.filter((a) => a.id !== 'null' && !ownedIds.has(a.id))
    .map((a) => bij('warn', `adapter ${a.id} has no fixture — it is never validated end-to-end`,
      'add a minimal fixture + case + measured baseline'));
}

/** 12. Coverage report older than the newest test file — blindspot findings would lie. */
export async function checkStaleCoverageReport(dir: string): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const summaryPath = join(dir, 'coverage', 'coverage-summary.json');
  const { stat } = await import('node:fs/promises');
  const reportMtime = await stat(summaryPath).then((s) => s.mtimeMs).catch(() => 0);
  if (!reportMtime) return { findings, fixes: [] };
  let newest = 0;
  let newestFile = '';
  for (const root of ['src', 'tests']) {
    const abs = join(dir, root);
    if (!(await exists(abs))) continue;
    for (const f of await walkSrc(abs, abs)) {
      if (!/\.(test|spec)\.[tj]sx?$/.test(f)) continue;
      const m = await stat(join(abs, f)).then((s) => s.mtimeMs).catch(() => 0);
      if (m > newest) { newest = m; newestFile = join(root, f); }
    }
  }
  if (newest > reportMtime) {
    findings.push({
      check: 'stale-coverage',
      severity: 'warn',
      message: `coverage report predates ${newestFile} — coverage numbers (and blindspot findings) reflect an older tree`,
      hint: 'refresh: npm run coverage (or the adapter coverage command)',
    });
  }
  return { findings, fixes: [] };
}
