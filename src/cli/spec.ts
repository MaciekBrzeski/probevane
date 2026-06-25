import { resolve, join, basename } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { anthropicBrain } from '../brain/anthropic-sdk.js';
import { buildSpec } from '../spec/build.js';

// probevane spec <dir> [--narrate] [--out <file>] [--wiki]
//   Generate a project specification (module graph, responsibilities, API
//   surface, coverage). --narrate adds an LLM one-liner per module.
//   --wiki publishes it to the probevane wiki as a "Projects" page.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const narrate = args.includes('--narrate');
  const toWiki = args.includes('--wiki');
  const outFlag = flag(args, '--out');

  const adapter = await selectAdapterOrThrow(dir);
  const md = await buildSpec({
    dir,
    adapter,
    brain: narrate ? anthropicBrain() : undefined,
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

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
