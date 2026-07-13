import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildGraph } from '../mock/index.js';
import { toMermaid, toAscii, graphSummary } from '../mock/render.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane graph` backend — render the module dependency graph (ASCII tree +
// Mermaid). Moved verbatim from the old src/cli/graph.ts shell; the local
// bare-flag `--mermaid` variant is now the interpreter's `str?` type ('' =
// present without a value → default out path).

/** Render ctx.dir's module graph; --mermaid [file] writes the diagram out. */
export async function run(ctx: CommandCtx): Promise<void> {
  const graph = await buildGraph(ctx.dir);
  const full = ctx.flags.full === true; // --full disables hub-collapse on big graphs
  console.log(`[probevane] ${graphSummary(graph)}\n`);
  console.log(toAscii(graph, !full && graph.nodes.size > 40 ? { collapseHubs: 8 } : undefined));

  const mermaid = toMermaid(graph);
  const mermaidOut = ctx.flags.mermaid as string | undefined;
  if (mermaidOut !== undefined) {
    const out = mermaidOut || join(ctx.dir, 'module-graph.md');
    await writeFile(out, `# Module graph\n\n${graphSummary(graph)}\n\n${mermaid}\n`);
    console.log(`\n[probevane] wrote Mermaid → ${out}`);
  } else {
    console.log('\n--- Mermaid (paste into the wiki / GitHub, or pass --mermaid <file>) ---\n');
    console.log(mermaid);
  }
}
