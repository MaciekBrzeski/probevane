import { resolve, join, basename } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { brainFor } from '../brain/select.js';
import { buildSpec } from './spec/build.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane spec` backend — generate a project specification (module graph,
// responsibilities, API surface, coverage). --narrate adds an LLM one-liner
// per module (any brain via --model, e.g. openai:<model> / local:<model> /
// bridge; default Anthropic); --wiki publishes it to the probevane wiki as a
// "Projects" page. Logic moved verbatim from the old src/cli/spec.ts shell;
// `-cmd` suffix because src/commands/spec/ is the buildSpec module dir.

/** Build the SPEC.md for ctx.dir and write it to --out / <dir>/SPEC.md / the wiki. */
export async function run(ctx: CommandCtx): Promise<void> {
  const dir = ctx.dir;
  const narrate = ctx.flags.narrate as boolean;
  const toWiki = ctx.flags.wiki as boolean;
  const outFlag = ctx.flags.out as string | undefined;

  const adapter = await selectAdapterOrThrow(dir);
  const md = await buildSpec({
    dir,
    adapter,
    brain: narrate ? brainFor(ctx.flags.model as string | undefined) : undefined,
    stamp: new Date().toISOString().slice(0, 10),
  });

  let out = outFlag ?? join(dir, 'SPEC.md');
  if (toWiki) {
    const root = process.env.PROBEVANE_ROOT ?? resolve(new URL('../..', import.meta.url).pathname);
    const wikiDir = join(root, 'docs', 'wiki');
    await mkdir(wikiDir, { recursive: true });
    out = join(wikiDir, `project-${basename(dir)}.md`);
  }
  await writeFile(out, md);
  console.log(`[probevane] wrote ${out} (${md.split('\n').length} lines${narrate ? ', narrated' : ''})`);
}
