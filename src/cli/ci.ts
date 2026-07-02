import { join } from 'node:path';
import { access, appendFile, readFile } from 'node:fs/promises';
import { selectAdapter } from '../adapters/registry.js';
import { isEasyTarget } from '../loop/triage.js';
import { simulateCost } from '../cost/simulate.js';
import { loadConfig } from '../config.js';
import { changedFiles, isSourceFile, specCandidatesFor } from '../git.js';
import { getDiff, reviewDiffText, findingsMarkdown, findingsTask } from '../review/diff-review.js';
import { groundFindings, verifyFindings } from '../review/verify.js';
import { brainFor } from '../brain/select.js';
import { sh } from '../util/exec.js';
import { flag, dirArg } from './args.js';

// probevane ci <dir> [--base <ref>] [--generate]
//
// PR helper: report changed source files lacking tests + current coverage, and
// (with --generate, needs ANTHROPIC_API_KEY) generate tests for the untested
// changed files. Emits a markdown summary to stdout and $GITHUB_STEP_SUMMARY.

type Cfg = Awaited<ReturnType<typeof loadConfig>>;
type Adapter = NonNullable<Awaited<ReturnType<typeof selectAdapter>>>;

/** Changed source files that have no matching spec yet. */
async function findUntested(dir: string, changed: string[]): Promise<string[]> {
  const untested: string[] = [];
  for (const f of changed) {
    let hasSpec = false;
    for (const cand of specCandidatesFor(f)) if (await exists(join(dir, cand))) hasSpec = true;
    if (!hasSpec) untested.push(f);
  }
  return untested;
}

/** Generate tests for the untested changed files (needs a key). Returns 1 if accepted. */
async function maybeGenerate(
  args: string[],
  dir: string,
  cfg: Cfg,
  adapter: Adapter,
  untested: string[],
): Promise<number> {
  if (!(args.includes('--generate') && untested.length && process.env.ANTHROPIC_API_KEY)) return 0;
  const { generateTests } = await import('../loop/run-generation.js');
  const outcome = await generateTests({
    dir,
    kind: 'unit',
    adapter,
    model: cfg.model ?? 'auto',
    maxTargets: Math.min(untested.length, 6),
    minTests: cfg.minTests,
    mock: cfg.mock ?? true,
    log: (l) => console.error(l),
  }).catch((e) => {
    console.error(`[probevane] generation failed: ${e}`);
    return null;
  });
  return outcome?.accepted ? 1 : 0;
}

// Review → auto-fix: review the diff, then (if findings) run the fix path and
// commit the remediation back to the branch.
async function runReviewFix(args: string[], dir: string, cfg: Cfg, base: string, adapter: Adapter): Promise<string> {
  if (!(args.includes('--review-fix') && process.env.ANTHROPIC_API_KEY)) return '';
  const reviewer = brainFor(cfg.model && cfg.model !== 'auto' ? cfg.model : 'sonnet');
  const diff = await getDiff(dir, base);
  const raw = await reviewDiffText(diff, reviewer).catch(() => []);
  // GATE issue-discovery: drop hallucinated refs, then an INDEPENDENT skeptic
  // refutes; only verified findings are acted on.
  const grounded = await groundFindings(dir, raw);
  const verifier = brainFor('sonnet'); // fresh, independent
  const findings = await verifyFindings(grounded, diff, verifier).catch(() => grounded);
  if (raw.length !== findings.length)
    console.error(`[probevane] review: ${raw.length} raw → ${grounded.length} grounded → ${findings.length} verified`);
  let reviewMd = '\n' + findingsMarkdown(findings);
  const actionable = findings.filter((f) => f.severity !== 'nit');
  if (!actionable.length) return reviewMd;
  const { runPath } = await import('../loop/run-path.js');
  console.error(`[probevane] review: ${actionable.length} actionable finding(s) — running fix path`);
  const outcome = await runPath({
    dir,
    adapter,
    profileName: 'fix',
    task: findingsTask(actionable),
    model: cfg.model ?? 'auto',
    budget: cfg.budget,
    log: (l) => console.error(l),
  }).catch(() => null);
  if (outcome?.accepted) {
    await sh('git add -A && git -c user.name=probevane -c user.email=probevane@local commit -m "probevane: auto-fix review findings"', dir);
    reviewMd += `\n_Auto-fixed ${actionable.length} finding(s) and committed; suite green._\n`;
  } else {
    reviewMd += `\n_Findings reported; auto-fix did not converge — fix manually._\n`;
  }
  return reviewMd;
}

// Cost preview: triage the untested changed files → estimated $ to cover them.
async function costPreview(dir: string, untested: string[]): Promise<string> {
  if (!untested.length) return '';
  let e = 0,
    h = 0;
  for (const f of untested) {
    const s = await readFile(join(dir, f), 'utf8').catch(() => '');
    isEasyTarget({ sourcePath: f, name: f, kind: 'unit' } as any, s).easy ? e++ : h++;
  }
  const sim = simulateCost({ easy: e, hard: h });
  return `- est. cost to cover: **$${sim[0].cost.toFixed(2)}** all-api · hybrid $${sim[1].cost.toFixed(2)} · bridge $0  _(${e} local-draftable, ${h} bridge)_`;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const cfg = await loadConfig(dir);
  const base = flag(args, '--base') ?? 'HEAD~1';
  const doGenerate = args.includes('--generate');

  const adapter = await selectAdapter(dir);
  if (!adapter) {
    await emit(`### probevane\nNo supported stack detected.\n`);
    return;
  }

  const changed = (await changedFiles(dir, base)).filter(isSourceFile);
  const untested = await findUntested(dir, changed);

  const generated = await maybeGenerate(args, dir, cfg, adapter, untested);
  const reviewMd = await runReviewFix(args, dir, cfg, base, adapter);
  const cov = await adapter.coverage(dir).catch(() => null);
  const costLine = await costPreview(dir, untested);

  const md = [
    `### 🧪 probevane — ${adapter.id}`,
    ``,
    `- changed source files: **${changed.length}**`,
    `- changed files without tests: **${untested.length}**`,
    costLine,
    cov?.ok ? `- coverage: **${cov.statements}%** statements` : `- coverage: n/a`,
    doGenerate ? `- generated tests: ${generated ? '✅ accepted' : '—'}` : '',
    untested.length ? `\n<details><summary>Untested changed files</summary>\n\n${untested.map((f) => `- \`${f}\``).join('\n')}\n</details>` : '',
    reviewMd,
    '',
  ].join('\n');

  await emit(md);
  // CI signal: fail if untested changed files remain and we weren't asked to generate.
  if (!doGenerate && untested.length && args.includes('--strict')) process.exit(1);
}

async function emit(md: string): Promise<void> {
  console.log(md);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, md + '\n').catch(() => {});
}
const exists = (p: string) => access(p).then(() => true).catch(() => false);

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
