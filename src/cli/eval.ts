import { resolve, join } from 'node:path';
import { readFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { appendLog } from '../library/improvement-log.js';
import { scoreFixture, judge, type Baseline } from '../../eval/scorer.js';
import { flag } from './args.js';

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

// Live mode: regenerate the fixture suite from zero before scoring. Returns
// the run's cost/token footprint so the improvement-log can join quality × $.
interface LiveStats { costUsd: number; tokensIn: number; tokensOut: number }
async function liveGenerate(c: EvalCase, dir: string, adapter: Adapter, base: Baseline): Promise<LiveStats | null> {
  const { anthropicBrain } = await import('../brain/anthropic-sdk.js');
  const { generateTests } = await import('../loop/run-generation.js');
  const brain = anthropicBrain();
  console.log(`[eval] live generating ${c.fixture}.${c.kind}…`);
  const outcome = await generateTests({
    dir,
    kind: c.kind,
    adapter,
    brain,
    minTests: base.minTests,
    minCoverage: base.minCoverage,
    // Strict: CI enforces the correctness floor (mutation gate) + proactively
    // steers the model to kill surviving mutants. Self-eval is where default-on
    // bites — every fixture must prove its suite catches bugs, not just runs green.
    mutation: true,
    mutationTarget: true,
    log: (l) => console.error(l),
  }).catch((e) => {
    console.error(`[eval] generation failed: ${e}`);
    return null;
  });
  if (!outcome?.accepted) console.log(`[eval] ${c.fixture}.${c.kind}: generation did not accept`);
  if (!outcome) return null;
  const { costOf } = await import('../cost/pricing.js');
  return {
    costUsd: costOf(brain.model, { input: outcome.tokensIn, output: outcome.tokensOut, cacheRead: outcome.cacheRead }),
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
  };
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
  // Self-sufficient on a fresh host: bootstrap the fixture's toolchain
  // (e.g. python .venv). Idempotent; a failure surfaces in the score anyway.
  await adapter.install(dir).catch((e) => console.error(`[eval] install ${c.fixture}: ${e}`));
  const stats = live ? await liveGenerate(c, dir, adapter, base) : null;

  const score = await scoreFixture(dir, adapter, {
    scope: c.kind,
    flakeRuns,
    oracleAssertions: base.oracleAssertions,
  });
  const verdict = judge(score, base);

  // Live runs also grade correctness: does the fresh suite actually kill
  // mutants? Budget-capped, best-effort — a mutation failure never blocks eval.
  let mutation: number | undefined;
  if (live) {
    const { mutationScore } = await import('../loop/mutation.js');
    mutation = await mutationScore(dir, adapter, 5, 3, { budgetMs: 60_000 })
      .then((m) => (m.total > 0 ? Math.round((m.killed / m.total) * 100) / 100 : undefined))
      .catch(() => undefined);
  }

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
    mutation,
    cost_usd: stats ? Math.round(stats.costUsd * 1e4) / 1e4 : undefined,
    tokens_in: stats?.tokensIn,
    tokens_out: stats?.tokensOut,
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
  await cp(src, dir, {
    recursive: true,
    // .venv excluded: interpreter/shebang paths bake in the source dir — the
    // adapter's install() bootstraps a fresh one in the copy instead.
    filter: (p) => !p.includes('node_modules') && !p.includes('/coverage') && !p.includes('/.venv'),
  });
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
  model: string;
  stamp: string;
  logPath: string;
}

async function runOnePathCase(c: PathCase, opts: PathOpts): Promise<boolean> {
  const { live, record, stamp, logPath } = opts;
  const rec = `${join(ROOT, 'eval', 'cassettes', `${c.fixture}.${c.path}.jsonl`)}.rec`;
  const base = JSON.parse(
    await readFile(join(ROOT, 'eval', 'baseline', `${c.fixture}.${c.path}.json`), 'utf8'),
  ) as Baseline;
  const cassette = join(ROOT, 'eval', 'cassettes', `${c.fixture}.${c.path}.jsonl`);
  const dir = await setupPathCase(c);

  const adapter = await selectAdapterOrThrow(dir);
  await adapter.install(dir).catch((e) => console.error(`[eval] install ${c.fixture}: ${e}`));
  const model = live ? opts.model : `replay:${cassette}`;
  if (record) {
    // Record to a sidecar; the committed cassette is only replaced when the
    // run ACCEPTS — a failed recording must not clobber a working cassette.
    await rm(rec, { force: true }).catch(() => {});
    process.env.PROBEVANE_RECORD = rec;
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
  if (record) {
    if (outcome?.accepted) {
      await (await import('node:fs/promises')).rename(rec, cassette);
    } else {
      await rm(rec, { force: true }).catch(() => {});
      console.error(`[eval] ${c.fixture}.${c.path}: recording did not accept — kept the old cassette`);
    }
  }

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
    tokens_in: outcome?.tokensIn, tokens_out: outcome?.tokensOut,
  });
  console.log(`[eval] ${c.fixture}.${c.path}: ${ok ? 'PASS' : `FAIL (${outcome?.accepted ? verdict.reasons.join('; ') : 'did not accept'})`} — tests=${score.tests} green=${score.green} audit=${score.auditScore}/5`);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return ok;
}

// probevane eval --paths [--live] [--record] [--model <m>]
//   Regression-test the refactor/feature/repair PATHS. --live runs the real
//   loop (needs a key, or --model bridge for $0); --record also saves a
//   cassette to eval/cassettes/ (only replaced when the run accepts). With
//   neither, each case REPLAYS its cassette → deterministic + credit-free (CI).
async function runPathCases(args: string[]) {
  const live = args.includes('--live');
  const record = args.includes('--record');
  const model = flag(args, '--model') ?? 'haiku';
  process.env.PROBEVANE_DETERMINISTIC = '1'; // stable prompts → reproducible cassettes (record + replay)
  const stamp = new Date().toISOString();
  const logPath = join(ROOT, 'eval', 'improvement-log.csv');
  const cases: PathCase[] = (await readFile(join(ROOT, 'eval', 'path-cases.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  let pass = 0;
  for (const c of cases) {
    if (await runOnePathCase(c, { live, record, model, stamp, logPath })) pass++;
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

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
