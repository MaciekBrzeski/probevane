import { resolve, join } from 'node:path';
import { access, appendFile } from 'node:fs/promises';
import { selectAdapter } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { changedFiles, isSourceFile, specCandidatesFor } from '../git.js';

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

  const cov = await adapter.coverage(dir).catch(() => null);

  const md = [
    `### 🧪 probevane — ${adapter.id}`,
    ``,
    `- changed source files: **${changed.length}**`,
    `- changed files without tests: **${untested.length}**`,
    cov?.ok ? `- coverage: **${cov.statements}%** statements` : `- coverage: n/a`,
    doGenerate ? `- generated tests: ${generated ? '✅ accepted' : '—'}` : '',
    untested.length ? `\n<details><summary>Untested changed files</summary>\n\n${untested.map((f) => `- \`${f}\``).join('\n')}\n</details>` : '',
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
