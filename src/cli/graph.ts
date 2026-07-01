import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildGraph } from '../mock/index.js';
import { toMermaid, toAscii, graphSummary } from '../mock/render.js';

// probevane graph <dir> [--mermaid <out.md>]
//   Show the module dependency graph (the chain the mock maker walks).
//   ASCII tree to the terminal; optional Mermaid diagram written to a file.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const mermaidOut = flag(args, '--mermaid');

  const graph = await buildGraph(dir);
  const full = args.includes('--full'); // --full disables hub-collapse on big graphs
  console.log(`[probevane] ${graphSummary(graph)}\n`);
  console.log(toAscii(graph, !full && graph.nodes.size > 40 ? { collapseHubs: 8 } : undefined));

  const mermaid = toMermaid(graph);
  if (mermaidOut !== undefined) {
    const out = mermaidOut || join(dir, 'module-graph.md');
    await writeFile(out, `# Module graph\n\n${graphSummary(graph)}\n\n${mermaid}\n`);
    console.log(`\n[probevane] wrote Mermaid → ${out}`);
  } else {
    console.log('\n--- Mermaid (paste into the wiki / GitHub, or pass --mermaid <file>) ---\n');
    console.log(mermaid);
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : '';
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
