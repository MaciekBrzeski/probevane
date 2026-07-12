import { basename, isAbsolute, relative } from 'node:path';
import { loadConfig } from '../util/config.js';
import { runDocs } from '../loop/run/docs.js';
import { flag, dirArg } from '../util/args.js';

// probevane docs <dir> [--out <path>] [--sections a,b,c] [--model …] [--max-steps N] [--budget N]
//
// Stack-agnostic narrative documentation loop: grounds a model on a project
// digest and writes a comprehensive Markdown guide, gated so it cites only real
// paths. Works on any language (no stack adapter required) — unlike `document`
// (JSDoc on source) and `spec` (TS-import structured dump).
const DEFAULT_SECTIONS = 'Overview,Architecture,Key concepts,Project layout,Getting started,Glossary';

// Entry: resolve flags > config, confine --out inside <dir>, run the docs loop,
// exit 1 when the loop does not accept.
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const cfg = await loadConfig(dir);
  const name = basename(dir);

  // outPath must be RELATIVE to dir: the loop writes it via write_file (workdir-
  // confined) and the gates read join(dir, outPath). Relativize an absolute --out
  // (must be inside dir) so both agree — else the gate looks at the wrong path.
  const outArg = flag(args, '--out') ?? `docs/${name}-guide.md`;
  const out = isAbsolute(outArg) ? relative(dir, outArg) : outArg;
  if (out.startsWith('..')) {
    console.error(`[probevane] docs: --out must be inside <dir> (${dir})`);
    process.exit(2);
  }
  const sections = (flag(args, '--sections') ?? DEFAULT_SECTIONS).split(',').map((s) => s.trim()).filter(Boolean);
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 24), 10);
  const budgetRaw = flag(args, '--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  console.error(`[probevane] docs dir=${dir} sections=[${sections.join(', ')}]`);
  const outcome = await runDocs({ dir, outPath: out, sections, model, maxSteps, budget, log: (l) => console.error(l) });
  console.log(
    `[probevane] ${outcome.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} (${outcome.stopReason}) steps=${outcome.steps} ` +
      `tokens=${outcome.tokensIn}/${outcome.tokensOut}${outcome.tookOver ? ' (took over)' : ''} -> ${out}`,
  );
  if (!outcome.accepted) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
