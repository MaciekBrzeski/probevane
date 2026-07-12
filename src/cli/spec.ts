import { resolve, join, basename } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { brainFor } from '../brain/select.js';
import { buildSpec } from '../commands/spec/build.js';
import { flag, dirArg } from '../util/args.js';

// probevane spec <dir> [--narrate] [--model <id>] [--out <file>] [--wiki]
//   Generate a project specification (module graph, responsibilities, API
//   surface, coverage). --narrate adds an LLM one-liner per module (any brain via
//   --model, e.g. openai:<model> / local:<model> / bridge; default Anthropic).
//   --wiki publishes it to the probevane wiki as a "Projects" page.
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const narrate = args.includes('--narrate');
  const toWiki = args.includes('--wiki');
  const outFlag = flag(args, '--out');

  const adapter = await selectAdapterOrThrow(dir);
  const md = await buildSpec({
    dir,
    adapter,
    brain: narrate ? brainFor(flag(args, '--model')) : undefined,
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

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
