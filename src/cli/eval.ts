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

interface EvalCase {
  fixture: string;
  kind: 'unit' | 'e2e';
}

async function main() {
  const args = process.argv.slice(2);
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
    const base = JSON.parse(
      await readFile(join(ROOT, 'eval', 'baseline', `${c.fixture}.${c.kind}.json`), 'utf8'),
    ) as Baseline;

    let dir = join(ROOT, 'fixtures', c.fixture);
    if (live) dir = await prepareLive(c, dir);

    const adapter = await selectAdapterOrThrow(dir);

    if (live) {
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

    const score = await scoreFixture(dir, adapter, {
      scope: c.kind,
      flakeRuns,
      oracleAssertions: base.oracleAssertions,
    });
    const verdict = judge(score, base);
    if (verdict.pass) pass++;

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
  }

  console.log(`[eval] ${pass}/${cases.length} cases passed (${live ? 'live' : 'ci-baseline'}) → ${logPath}`);
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
