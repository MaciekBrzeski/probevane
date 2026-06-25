import { describe, it, expect } from 'vitest';
import { toMermaid } from '../src/mock/render.js';
import type { ModuleGraph, ModuleNode } from '../src/mock/graph.js';

/** Build a ModuleGraph with `count` nodes spread across the given dirs. */
function makeGraph(count: number, dirs: string[], edges?: [string, string][]): ModuleGraph {
  const nodes = new Map<string, ModuleNode>();
  // Distribute nodes across dirs as evenly as possible
  for (let i = 0; i < count; i++) {
    const dir = dirs[i % dirs.length];
    const path = `src/${dir}/module${i}.ts`;
    nodes.set(path, {
      path,
      kind: 'util',
      imports: [],
      callsNetwork: false,
    });
  }
  // Wire up requested edges (override imports)
  if (edges) {
    for (const [from, to] of edges) {
      const node = nodes.get(from);
      if (node) node.imports = [...node.imports, to];
    }
  }
  return { nodes, order: [...nodes.keys()] };
}

describe('toMermaid — directory clustering', () => {
  it('groups nodes into subgraphs when graph has more than 40 nodes', () => {
    // 41 nodes → must cluster
    const graph = makeGraph(41, ['cli', 'loop']);
    const output = toMermaid(graph);

    expect(output).toContain('subgraph cli');
    expect(output).toContain('subgraph loop');
    // each subgraph block must be closed
    const endCount = (output.match(/^\s*end\s*$/gm) ?? []).length;
    expect(endCount).toBeGreaterThanOrEqual(2);
  });

  it('keeps flat (no subgraph) output when graph has exactly 40 nodes', () => {
    const graph = makeGraph(40, ['cli', 'loop']);
    const output = toMermaid(graph);

    expect(output).not.toContain('subgraph');
    // flat node declarations should be present at top level
    expect(output).toContain('src_cli_module0');
  });

  it('keeps flat (no subgraph) output when graph has fewer than 40 nodes', () => {
    const graph = makeGraph(5, ['adapters']);
    const output = toMermaid(graph);

    expect(output).not.toContain('subgraph');
    expect(output).toContain('src_adapters_module0');
  });

  it('places edges after subgraph blocks in a large graph', () => {
    const graph = makeGraph(41, ['cli', 'loop']);
    // Add an edge from first node to second node
    const keys = [...graph.nodes.keys()];
    const fromPath = keys[0]; // src/cli/module0.ts
    const toPath = keys[1];   // src/loop/module1.ts
    graph.nodes.get(fromPath)!.imports = [toPath];

    const output = toMermaid(graph);

    expect(output).toContain('subgraph');
    // edge arrow must still appear
    expect(output).toContain(' --> ');

    // All subgraph blocks should come before the edges section
    const lastSubgraphEnd = output.lastIndexOf('end');
    const firstEdge = output.indexOf(' --> ');
    expect(firstEdge).toBeGreaterThan(lastSubgraphEnd);
  });

  it('uses the correct top-level directory name as the subgraph label', () => {
    const graph = makeGraph(42, ['alpha', 'beta', 'gamma']);
    const output = toMermaid(graph);

    expect(output).toContain('subgraph alpha');
    expect(output).toContain('subgraph beta');
    expect(output).toContain('subgraph gamma');
  });
});
