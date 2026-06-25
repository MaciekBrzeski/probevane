import { describe, it, expect } from 'vitest';
import { toMermaid } from '../src/mock/render.js';
import type { ModuleGraph, ModuleNode } from '../src/mock/graph.js';

/** Build a ModuleGraph with `count` nodes spread across the given dirs. */
function makeGraph(count: number, dirs: string[], edges?: [string, string][]): ModuleGraph {
  const nodes = new Map<string, ModuleNode>();
  for (let i = 0; i < count; i++) {
    const dir = dirs[i % dirs.length];
    const path = `src/${dir}/module${i}.ts`;
    nodes.set(path, { path, kind: 'util', imports: [], callsNetwork: false });
  }
  if (edges) for (const [from, to] of edges) { const n = nodes.get(from); if (n) n.imports = [...n.imports, to]; }
  return { nodes, order: [...nodes.keys()] };
}

describe('toMermaid — directory-level collapse for big graphs', () => {
  it('collapses a >40-node graph to one node per directory (not per file)', () => {
    const graph = makeGraph(60, ['cli', 'loop', 'adapters']);
    const out = toMermaid(graph);
    expect(out).toContain('flowchart LR');
    // a directory node with its file count, not 60 file nodes
    expect(out).toMatch(/cli\["cli\/ \(\d+\)"\]/);
    expect(out).not.toContain('module0'); // file-level nodes are gone
    // node lines (dir["..."]) are far fewer than the 60 input modules
    const nodeLines = (out.match(/\["/g) ?? []).length;
    expect(nodeLines).toBe(3);
  });

  it('draws only cross-directory edges (intra-dir import collapses away)', () => {
    const graph = makeGraph(50, ['cli', 'loop']);
    const keys = [...graph.nodes.keys()];
    const cliNode = keys.find((k) => k.includes('/cli/'))!;
    const loopNode = keys.find((k) => k.includes('/loop/'))!;
    graph.nodes.get(cliNode)!.imports = [loopNode]; // cross-dir
    const out = toMermaid(graph);
    expect(out).toContain('cli --> loop');
  });

  it('keeps a small (<=40) graph flat with per-file nodes + kind colors', () => {
    const graph = makeGraph(5, ['adapters']);
    const out = toMermaid(graph);
    expect(out).toContain('graph TD');
    expect(out).not.toContain('flowchart LR');
    expect(out).toContain('src_adapters_module0');
    expect(out).toContain('classDef util');
  });
});
