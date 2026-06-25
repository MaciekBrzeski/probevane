import { resolve, join } from 'node:path';
import { access, appendFile } from 'node:fs/promises';
import { selectAdapter } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { changedFiles, isSourceFile, specCandidatesFor } from '../git.js';
import { getDiff, reviewDiffText, findingsMarkdown, findingsTask } from '../review/diff-review.js';
import { groundFindings, verifyFindings } from '../review/verify.js';
import { brainFor } from '../brain/select.js';
import { sh } from '../util/exec.js';

// probevane ci <dir> [--base <ref>] [--generate]
//
// PR helper: report changed source files lacking tests + current coverage, and
// (with --generate, needs ANTHROPIC_API_KEY) generate tests for the untested
// changed files. Emits a markdown summary to stdout and $GITHUB_STEP_SUMMARY.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const base = flag(args, '--base') ?? 'HEAD~1';
  const doGenerate = args.includes('--generate');
  const reviewFix = args.includes('--review-fix');

  const adapter = await selectAdapter(dir);
  if (!adapter) {
    await emit(`### probevane\nNo supported stack detected.\n`);
    return;
  }

  const changed = (await changedFiles(dir, base)).filter(isSourceFile);
  const untested: string[] = [];
  for (const f of changed) {
    let hasSpec = false;
    for (const cand of specCandidatesFor(f)) if (await exists(join(dir, cand))) hasSpec = true;
    if (!hasSpec) untested.push(f);
  }

  let generated = 0;
  if (doGenerate && untested.length && process.env.ANTHROPIC_API_KEY) {
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
    if (outcome?.accepted) generated = 1;
  }

  // Review → auto-fix: review the diff, then (if findings) run the fix path and
  // commit the remediation back to the branch.
  let reviewMd = '';
  if (reviewFix && process.env.ANTHROPIC_API_KEY) {
    const reviewer = brainFor(cfg.model && cfg.model !== 'auto' ? cfg.model : 'sonnet');
    const diff = await getDiff(dir, base);
    const raw = await reviewDiffText(diff, reviewer).catch(() => []);
    // GATE issue-discovery: drop hallucinated refs, then an INDEPENDENT skeptic
    // refutes; only verified findings are acted on.
    const grounded = await groundFindings(dir, raw);
    const verifier = brainFor('sonnet'); // fresh, independent
    const findings = await verifyFindings(grounded, diff, verifier).catch(() => grounded);
    if (raw.length !== findings.length) console.error(`[probevane] review: ${raw.length} raw → ${grounded.length} grounded → ${findings.length} verified`);
    reviewMd = '\n' + findingsMarkdown(findings);
    const actionable = findings.filter((f) => f.severity !== 'nit');
    if (actionable.length) {
      const { runPath } = await import('../loop/run-path.js');
      console.error(`[probevane] review: ${actionable.length} actionable finding(s) — running fix path`);
      const outcome = await runPath({ dir, adapter, profileName: 'fix', task: findingsTask(actionable), model: cfg.model ?? 'auto', budget: cfg.budget, log: (l) => console.error(l) }).catch(() => null);
      if (outcome?.accepted) {
        await sh('git add -A && git -c user.name=probevane -c user.email=probevane@local commit -m "probevane: auto-fix review findings"', dir);
        reviewMd += `\n_Auto-fixed ${actionable.length} finding(s) and committed; suite green._\n`;
      } else {
        reviewMd += `\n_Findings reported; auto-fix did not converge — fix manually._\n`;
      }
    }
  }

  const cov = await adapter.coverage(dir).catch(() => null);

  const md = [
    `### 🧪 probevane — ${adapter.id}`,
    ``,
    `- changed source files: **${changed.length}**`,
    `- changed files without tests: **${untested.length}**`,
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
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
