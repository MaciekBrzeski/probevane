import { describe, it, expect } from 'vitest';
import { toFolderTree } from '../src/mock/render.js';
import { archMetrics, archDigest, topDir } from '../src/arch/metrics.js';
import { archPrompt } from '../src/arch/critique.js';
import type { ModuleGraph, ModuleNode } from '../src/mock/graph.js';

function graph(nodes: (Pick<ModuleNode, 'path' | 'kind'> & Partial<ModuleNode>)[]): ModuleGraph {
  const map = new Map(nodes.map((n) => [n.path, { ...n, imports: n.imports ?? [], callsNetwork: n.callsNetwork ?? false }]));
  return { nodes: map, order: [...map.keys()] };
}

describe('render.toFolderTree', () => {
  it('nests dirs with recursive file counts, sorted', () => {
    const out = toFolderTree(['src/cli/a.ts', 'src/cli/b.ts', 'src/loop/runes/r.ts', 'src/loop/engine.ts']);
    expect(out).toBe([
      'src/ (4)',
      '├─ cli/ (2)',
      '└─ loop/ (2)',
      '   └─ runes/ (1)',
    ].join('\n'));
  });
  it('is empty for no paths', () => {
    expect(toFolderTree([])).toBe('');
  });
});

describe('arch.topDir', () => {
  it('takes the segment under src/, else the bare filename bucket', () => {
    expect(topDir('src/cli/x.ts')).toBe('cli');
    expect(topDir('src/config.ts')).toBe('config.ts');
    expect(topDir('cli/x.ts')).toBe('cli');
  });
});

describe('arch.archMetrics', () => {
  const g = graph([
    { path: 'src/cli/run.ts', kind: 'util', imports: ['src/loop/engine.ts', 'src/util/exec.ts'] },
    { path: 'src/loop/engine.ts', kind: 'util', imports: ['src/util/exec.ts'] },
    { path: 'src/util/exec.ts', kind: 'util', imports: [] },
  ]);
  const m = archMetrics(g);

  it('computes per-dir files + fanOut/fanIn', () => {
    const cli = m.dirs.find((d) => d.dir === 'cli')!;
    expect(cli.fanOut).toBe(2); // loop, util
    expect(cli.fanIn).toBe(0);
    const util = m.dirs.find((d) => d.dir === 'util')!;
    expect(util.fanIn).toBe(2); // cli, loop import it
    expect(util.fanOut).toBe(0);
  });
  it('weights cross-dir edges + ignores intra-dir', () => {
    expect(m.edges.find((e) => e.from === 'cli' && e.to === 'util')!.count).toBe(1);
    expect(m.edges.some((e) => e.from === e.to)).toBe(false);
  });
  it('detects directory cycles', () => {
    const cyc = graph([
      { path: 'src/a/x.ts', kind: 'util', imports: ['src/b/y.ts'] },
      { path: 'src/b/y.ts', kind: 'util', imports: ['src/a/x.ts'] },
    ]);
    expect(archMetrics(cyc).cycles).toEqual([['a', 'b']]);
  });
  it('digest lists coupling, edges, and cycles', () => {
    const d = archDigest(m);
    expect(d).toContain('Directory coupling');
    expect(d).toContain('Directory cycles: none');
  });
});

describe('arch.archPrompt', () => {
  it('assembles the folder tree, metrics, and dep tree into one prompt', () => {
    const p = archPrompt('FOLDER', 'DEPTREE', '3 modules', 'METRICS');
    expect(p).toContain('# Folder structure');
    expect(p).toContain('FOLDER');
    expect(p).toContain('METRICS');
    expect(p).toContain('DEPTREE');
    expect(p).toContain('3 modules');
  });
});
