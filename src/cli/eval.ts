import { resolve, join } from 'node:path';
import { readFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { appendLog } from '../library/improvement-log.js';
import { scoreFixture, judge, type Baseline } from '../../eval/scorer.js';

// probevane eval [--live] [--flake N]
//
// Default (CI mode, NO LLM): score each fixture's committed suite and judge it
// against eval/baseline/<fixture>.<kind>.json. This is the harness's own
// no-regression gate — fixtures must stay green, audit-clean, covered, and
// shadow-oracle-complete. Appends a row to eval/improvement-log.csv.
//
// --live (local/nightly, needs ANTHROPIC_API_KEY + browsers): copy each fixture
// to a temp dir, strip its tests, regenerate from zero with the gated loop, then
// score + judge the GENERATED suite. This measures generation quality / transfer.

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

type Adapter = Awaited<ReturnType<typeof selectAdapterOrThrow>>;

interface EvalCase {
  fixture: string;
  kind: 'unit' | 'e2e';
}

// Live mode: regenerate the fixture suite from zero before scoring.
async function liveGenerate(c: EvalCase, dir: string, adapter: Adapter, base: Baseline): Promise<void> {
  const { anthropicBrain } = await import('../brain/anthropic-sdk.js');
  const { generateTests } = await import('../loop/run-generation.js');
  console.log(`[eval] live generating ${c.fixture}.${c.kind}…`);
  const outcome = await generateTests({
    dir,
    kind: c.kind,
    adapter,
    brain: anthropicBrain(),
    minTests: base.minTests,
    minCoverage: base.minCoverage,
    log: (l) => console.error(l),
  }).catch((e) => {
    console.error(`[eval] generation failed: ${e}`);
    return null;
  });
  if (!outcome?.accepted) console.log(`[eval] ${c.fixture}.${c.kind}: generation did not accept`);
}

interface EvalOpts {
  live: boolean;
  flakeRuns: number;
  stamp: string;
  logPath: string;
}

async function runEvalCase(c: EvalCase, opts: EvalOpts): Promise<boolean> {
  const { live, flakeRuns, stamp, logPath } = opts;
  const base = JSON.parse(
    await readFile(join(ROOT, 'eval', 'baseline', `${c.fixture}.${c.kind}.json`), 'utf8'),
  ) as Baseline;

  let dir = join(ROOT, 'fixtures', c.fixture);
  if (live) dir = await prepareLive(c, dir);

  const adapter = await selectAdapterOrThrow(dir);
  if (live) await liveGenerate(c, dir, adapter, base);

  const score = await scoreFixture(dir, adapter, {
    scope: c.kind,
    flakeRuns,
    oracleAssertions: base.oracleAssertions,
  });
  const verdict = judge(score, base);

  await appendLog(logPath, {
    timestamp: stamp,
    target: c.fixture,
    kind: c.kind,
    pass: verdict.pass ? 1 : 0,
    audit_score: score.auditScore,
    tests: score.tests,
    coverage: score.coverage,
    flake: score.flake,
    note: live ? 'live' : 'ci-baseline',
  });

  const tag = verdict.pass ? 'PASS' : `FAIL (${verdict.reasons.join('; ')})`;
  console.log(
    `[eval] ${c.fixture}.${c.kind}: ${tag} — tests=${score.tests} cov=${score.coverage}% ` +
      `audit=${score.auditScore}/5 flake=${score.flake} oracle=${score.oracleHit}/${score.oracleTotal}`,
  );
  if (live) await rm(dir, { recursive: true, force: true }).catch(() => {});
  return verdict.pass;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--paths')) return runPathCases(args);
  const live = args.includes('--live');
  const flakeRuns = parseInt(flag(args, '--flake') ?? '3', 10);
  const stamp = new Date().toISOString();
  const logPath = join(ROOT, 'eval', 'improvement-log.csv');

  const cases: EvalCase[] = (await readFile(join(ROOT, 'eval', 'cases.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  let pass = 0;
  for (const c of cases) {
    if (await runEvalCase(c, { live, flakeRuns, stamp, logPath })) pass++;
  }

  console.log(`[eval] ${pass}/${cases.length} cases passed (${live ? 'live' : 'ci-baseline'}) → ${logPath}`);
  if (pass < cases.length) process.exit(1);
}

interface PathCase {
  fixture: string;
  path: 'refactor' | 'feature' | 'repair';
  task: string;
  mutate?: { file: string; from: string; to: string };
}

// Setup: copy fixture (keep golden tests — they protect behavior), then for
// repair break a test by mutating the source.
async function setupPathCase(c: PathCase): Promise<string> {
  const src = join(ROOT, 'fixtures', c.fixture);
  const dir = join(ROOT, '.probevane-live', `${c.fixture}-${c.path}`);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await cp(src, dir, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('/coverage') });
  await (await import('node:fs/promises'))
    .symlink(join(src, 'node_modules'), join(dir, 'node_modules'))
    .catch(() => {});
  if (c.mutate) {
    const { writeFile } = await import('node:fs/promises');
    const f = join(dir, c.mutate.file);
    const txt = await readFile(f, 'utf8');
    await writeFile(f, txt.replace(c.mutate.from, c.mutate.to));
  }
  return dir;
}

interface PathOpts {
  live: boolean;
  record: boolean;
  stamp: string;
  logPath: string;
}

async function runOnePathCase(c: PathCase, opts: PathOpts): Promise<boolean> {
  const { live, record, stamp, logPath } = opts;
  const base = JSON.parse(
    await readFile(join(ROOT, 'eval', 'baseline', `${c.fixture}.${c.path}.json`), 'utf8'),
  ) as Baseline;
  const cassette = join(ROOT, 'eval', 'cassettes', `${c.fixture}.${c.path}.jsonl`);
  const dir = await setupPathCase(c);

  const adapter = await selectAdapterOrThrow(dir);
  const model = live ? 'haiku' : `replay:${cassette}`;
  if (record) {
    await rm(cassette, { recursive: true, force: true }).catch(() => {});
    process.env.PROBEVANE_RECORD = cassette;
  }
  const { runPath } = await import('../loop/run-path.js');
  console.log(`[eval] ${live ? (record ? 'recording' : 'live') : 'replay'} ${c.fixture}.${c.path}…`);
  const outcome = await runPath({
    dir,
    adapter,
    profileName: c.path,
    task: c.task,
    model,
    budget: 16000,
    log: (l) => console.error(l),
  }).catch((e) => {
    console.error(`[eval] ${c.path} failed: ${e}`);
    return null;
  });
  delete process.env.PROBEVANE_RECORD;

  const score = await scoreFixture(dir, adapter, {
    scope: 'unit',
    flakeRuns: 1,
    oracleAssertions: base.oracleAssertions,
  });
  const verdict = judge(score, base);
  const ok = !!outcome?.accepted && verdict.pass;
  await appendLog(logPath, {
    timestamp: stamp, target: c.fixture, kind: c.path, pass: ok ? 1 : 0,
    audit_score: score.auditScore, tests: score.tests, coverage: score.coverage,
    flake: score.flake, note: live ? (record ? 'path-record' : 'path-live') : 'path-replay',
  });
  console.log(`[eval] ${c.fixture}.${c.path}: ${ok ? 'PASS' : `FAIL (${outcome?.accepted ? verdict.reasons.join('; ') : 'did not accept'})`} — tests=${score.tests} green=${score.green} audit=${score.auditScore}/5`);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return ok;
}

// probevane eval --paths [--live] [--record]
//   Regression-test the refactor/feature/repair PATHS. --live runs the real
//   loop (needs a key); --record also saves a cassette to eval/cassettes/. With
//   neither, each case REPLAYS its cassette → deterministic + credit-free (CI).
async function runPathCases(args: string[]) {
  const live = args.includes('--live');
  const record = args.includes('--record');
  process.env.PROBEVANE_DETERMINISTIC = '1'; // stable prompts → reproducible cassettes (record + replay)
  const stamp = new Date().toISOString();
  const logPath = join(ROOT, 'eval', 'improvement-log.csv');
  const cases: PathCase[] = (await readFile(join(ROOT, 'eval', 'path-cases.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  let pass = 0;
  for (const c of cases) {
    if (await runOnePathCase(c, { live, record, stamp, logPath })) pass++;
  }
  console.log(`[eval] paths: ${pass}/${cases.length} passed (${live ? 'live' : 'replay'})`);
  if (pass < cases.length) process.exit(1);
}

// Copy a fixture to a sibling temp dir, symlink-free node_modules, strip its
// committed tests so generation starts from zero. (Live mode only.)
async function prepareLive(c: EvalCase, src: string): Promise<string> {
  const dst = join(ROOT, '.probevane-live', `${c.fixture}-${c.kind}`);
  await rm(dst, { recursive: true, force: true }).catch(() => {});
  await cp(src, dst, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('/coverage') });
  // Reuse the fixture's installed deps via a symlink.
  const { symlink } = await import('node:fs/promises');
  await symlink(join(src, 'node_modules'), join(dst, 'node_modules')).catch(() => {});
  const adapter = await selectAdapterOrThrow(dst);
  for (const spec of await adapter.specFiles(dst)) await rm(join(dst, spec)).catch(() => {});
  return dst;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
