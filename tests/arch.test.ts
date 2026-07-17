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
  it('inbound = weighted import statements to rewrite on a move (the migration cost)', () => {
    const util = m.dirs.find((d) => d.dir === 'util')!;
    expect(util.inbound).toBe(2); // cli/run.ts + loop/engine.ts each import util/exec.ts
    const cli = m.dirs.find((d) => d.dir === 'cli')!;
    expect(cli.inbound).toBe(0); // nothing imports cli → cheap by this metric alone
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
  it('digest lists coupling, edges, cycles, and per-dir move-cost', () => {
    const d = archDigest(m);
    expect(d).toContain('Directory coupling');
    expect(d).toContain('to move'); // migration-cost legend + per-dir figure
    expect(d).toContain('util/  1 files · out 0 · in 2 · ~2 to move');
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

// ---------------------------------------------------------------------------
// archDrift — snapshot diffing
// ---------------------------------------------------------------------------
import { archDrift, type ArchMetrics } from '../src/arch/metrics.js';

const M = (over: Partial<ArchMetrics> = {}): ArchMetrics => ({
  dirs: [{ dir: 'loop', files: 10, fanOut: 2, fanIn: 3, inbound: 4, imports: ['brain', 'util'] }],
  edges: [{ from: 'loop', to: 'brain', count: 5 }],
  cycles: [],
  ...over,
});

describe('archDrift', () => {
  it('identical snapshots → no drift', () => {
    expect(archDrift(M(), M())).toEqual([]);
  });

  it('reports added/removed dirs and file-count changes', () => {
    const next = M({ dirs: [
      { dir: 'loop', files: 12, fanOut: 2, fanIn: 3, inbound: 4, imports: [] },
      { dir: 'server', files: 2, fanOut: 1, fanIn: 0, inbound: 0, imports: [] },
    ] });
    const d = archDrift(M(), next);
    expect(d).toContain('~ loop/ files 10 → 12');
    expect(d).toContain('+ dir server/ (2 files)');
    const gone = archDrift(next, M());
    expect(gone).toContain('- dir server/ removed');
  });

  it('edge deltas below the threshold are noise, above are drift', () => {
    const next = M({ edges: [{ from: 'loop', to: 'brain', count: 7 }] });
    expect(archDrift(M(), next)).toEqual([]); // +2 < default 3
    const big = M({ edges: [{ from: 'loop', to: 'brain', count: 9 }] });
    expect(archDrift(M(), big)).toContain('~ edge loop → brain 5 → 9');
    expect(archDrift(M(), next, 2)).toContain('~ edge loop → brain 5 → 7'); // custom threshold
  });

  it('flags new cycles loudly and resolved ones positively', () => {
    const withCycle = M({ cycles: [['library', 'observe']] });
    expect(archDrift(M(), withCycle)).toContain('+ CYCLE library↔observe');
    expect(archDrift(withCycle, M())).toContain('✓ cycle library↔observe resolved');
  });

  it('dropped heavy edge is reported', () => {
    const next = M({ edges: [] });
    expect(archDrift(M(), next)).toContain('- edge loop → brain dropped (was 5)');
  });
});

// ---------------------------------------------------------------------------
// pyramid model — isolated feature pyramids on a glue base
// ---------------------------------------------------------------------------
import { inferRole, pyramidReport, pyramidDigest } from '../src/arch/pyramid.js';

describe('pyramid.inferRole', () => {
  it('classifies from coupling: composition root = glue, broad base = shared, rest = feature', () => {
    expect(inferRole('cli', { fanIn: 0, fanOut: 5 })).toBe('glue');
    expect(inferRole('util', { fanIn: 6, fanOut: 0 })).toBe('shared');
    expect(inferRole('loop', { fanIn: 3, fanOut: 4 })).toBe('feature');
  });
  it('bare root-level files are connection layer', () => {
    expect(inferRole('config.ts', { fanIn: 5, fanOut: 0 })).toBe('glue');
  });
  it('explicit overrides beat the heuristic', () => {
    expect(inferRole('cost', { fanIn: 1, fanOut: 3 }, { shared: ['cost'] })).toBe('shared');
    expect(inferRole('server', { fanIn: 2, fanOut: 1 }, { glue: ['server'] })).toBe('glue');
    // pin as pyramid even when coupling reads as glue (fanIn 0, imports several)
    expect(inferRole('ui', { fanIn: 0, fanOut: 3 }, { feature: ['ui'] })).toBe('feature');
  });
});

describe('pyramid.pyramidReport', () => {
  // glue: cli (fanIn 0). shared: util (fanIn 4, fanOut 0). features: a, b, c, d.
  const g = graph([
    { path: 'src/cli/run.ts', kind: 'util', imports: ['src/a/api.ts', 'src/b/inner/deep.ts', 'src/util/x.ts'] },
    { path: 'src/a/api.ts', kind: 'util', imports: ['src/a/impl.ts', 'src/b/api.ts', 'src/util/x.ts'] },
    { path: 'src/a/impl.ts', kind: 'util', imports: [] },
    { path: 'src/b/api.ts', kind: 'util', imports: ['src/b/inner/deep.ts', 'src/util/x.ts'] },
    { path: 'src/b/inner/deep.ts', kind: 'util', imports: ['src/cli/run.ts'] },
    { path: 'src/c/only.ts', kind: 'util', imports: ['src/util/x.ts'] },
    { path: 'src/d/leaf.ts', kind: 'util', imports: [] },
    { path: 'src/util/x.ts', kind: 'util', imports: ['src/d/leaf.ts'] },
  ]);
  const r = pyramidReport(g);
  const find = (kind: string) => r.violations.find((v) => v.kind === kind);

  it('flags feature→feature with cost + example', () => {
    const v = find('feature→feature')!;
    expect([v.from, v.to]).toEqual(['a', 'b']);
    expect(v.count).toBe(1);
    expect(v.examples[0]).toBe('src/a/api.ts → src/b/api.ts');
  });
  it('flags feature→glue inversion', () => {
    const v = find('feature→glue')!;
    expect([v.from, v.to]).toEqual(['b', 'cli']);
  });
  it('flags shared→feature (base depending on a tip)', () => {
    const v = find('shared→feature')!;
    expect([v.from, v.to]).toEqual(['util', 'd']);
  });
  it('flags glue deep-reach past a pyramid base, but not glue→base', () => {
    const v = find('deep-reach')!;
    expect([v.from, v.to]).toEqual(['cli', 'b']); // cli → b/inner/deep.ts
    expect(r.violations.some((x) => x.kind === 'deep-reach' && x.to === 'a')).toBe(false); // cli → a/api.ts is legal
  });
  it('anyone→shared is legal, intra-pyramid imports count toward isolation', () => {
    const a = r.dirs.find((d) => d.dir === 'a')!;
    expect(a.role).toBe('feature');
    expect(a.intra).toBe(1); // api → impl
    expect(a.leaks).toBe(1); // api → b
    expect(a.isolation).toBe(0.5);
    const c = r.dirs.find((d) => d.dir === 'c')!;
    expect(c.leaks).toBe(0); // c → util is legal
    expect(c.isolation).toBe(1);
  });
  it('score = share of cross-dir imports that respect the model', () => {
    // cross imports: cli→a, cli→b(deep), cli→util, a→b, a→util, b→util, b→cli, c→util, util→d = 9; bad = 4
    expect(r.score).toBe(Math.round(100 * (1 - 4 / 9)));
  });
  it('a clean tree scores 100 and reports no violations (overrides flow through)', () => {
    const clean = pyramidReport(graph([
      { path: 'src/cli/run.ts', kind: 'util', imports: ['src/a/api.ts'] },
      { path: 'src/a/api.ts', kind: 'util', imports: [] },
    ]), { glue: ['cli'] }); // toy graph too small for the fanOut heuristic — declare the root
    expect(clean.score).toBe(100);
    expect(clean.violations).toEqual([]);
  });
  it('digest names roles, isolation, violations with fixes, and the score', () => {
    const d = pyramidDigest(r);
    expect(d).toContain('glue: cli');
    expect(d).toContain('shared: util');
    expect(d).toContain('[feature→feature] a → b (1)');
    expect(d).toContain('fix: route through glue');
    expect(d).toContain(`Pyramid score: ${r.score}/100`);
  });
  it('digest says so when the structure already fits', () => {
    const clean = pyramidReport(graph([{ path: 'src/a/x.ts', kind: 'util', imports: [] }]));
    expect(pyramidDigest(clean)).toContain('none — the structure already fits the model');
  });
});

// ---------------------------------------------------------------------------
// crowding — too many files in one folder → subfolder / move suggestions
// ---------------------------------------------------------------------------
import { crowdingReport, crowdingDigest } from '../src/arch/crowding.js';

describe('crowding.crowdingReport', () => {
  // src/big: 5 direct files — 3 share the "run" prefix (subfolder candidate),
  // loner.ts has zero intra-dir ties and is only imported by src/other (move
  // candidate), core.ts is used by a sibling so it stays.
  const g = graph([
    { path: 'src/big/run-path.ts', kind: 'util', imports: ['src/big/core.ts'] },
    { path: 'src/big/run-docs.ts', kind: 'util', imports: [] },
    { path: 'src/big/run-generation.ts', kind: 'util', imports: [] },
    { path: 'src/big/core.ts', kind: 'util', imports: [] },
    { path: 'src/big/loner.ts', kind: 'util', imports: [] },
    { path: 'src/other/user.ts', kind: 'util', imports: ['src/big/loner.ts', 'src/big/run-docs.ts'] },
    { path: 'src/other/user2.ts', kind: 'util', imports: ['src/big/loner.ts'] },
  ]);

  it('flags only dirs over the threshold', () => {
    expect(crowdingReport(g, 15)).toEqual([]);
    const crowded = crowdingReport(g, 4);
    expect(crowded.map((c) => c.dir)).toEqual(['src/big']);
    expect(crowded[0].files).toBe(5);
  });

  it('proposes a subfolder for a >=3-file name-prefix cluster', () => {
    const [big] = crowdingReport(g, 4);
    expect(big.clusters).toEqual([
      { prefix: 'run', files: ['run-docs.ts', 'run-generation.ts', 'run-path.ts'] },
    ]);
  });

  it('flags a zero-cohesion file pulled by exactly one other dir', () => {
    const [big] = crowdingReport(g, 4);
    expect(big.misplaced).toEqual([{ file: 'loner.ts', suggest: 'src/other', pulls: 2 }]);
    // run-docs is imported from outside too, but it belongs to the run-* cluster
    // by prefix; core.ts has a sibling importer → neither is misplaced.
    expect(big.misplaced.some((m) => m.file === 'core.ts')).toBe(false);
  });

  it('digest renders suggestions; empty when nothing is crowded', () => {
    const d = crowdingDigest(crowdingReport(g, 4), 4);
    expect(d).toContain('src/big/  5 files');
    expect(d).toContain('subfolder candidate src/big/run/ — 3 files');
    expect(d).toContain('loner.ts has no ties here — only src/other/ imports it (2×)');
    expect(crowdingDigest([], 15)).toBe('');
  });

  it('never flags index.* and suppresses registry-pattern mass pulls', () => {
    // plugins/: 4 loose files all imported once by src/host (an orchestrator) +
    // an index barrel. None should read as "misplaced" — that's the dir's design.
    const reg = graph([
      { path: 'src/plugins/alpha.ts', kind: 'util', imports: [] },
      { path: 'src/plugins/beta.ts', kind: 'util', imports: [] },
      { path: 'src/plugins/gamma.ts', kind: 'util', imports: [] },
      { path: 'src/plugins/index.ts', kind: 'util', imports: [] },
      { path: 'src/host/main.ts', kind: 'util', imports: ['src/plugins/alpha.ts', 'src/plugins/beta.ts', 'src/plugins/gamma.ts', 'src/plugins/index.ts'] },
    ]);
    const [crowded] = crowdingReport(reg, 3);
    expect(crowded.dir).toBe('src/plugins');
    expect(crowded.misplaced).toEqual([]);
  });

  it('says so when a crowded dir has no mechanical split', () => {
    const flat = graph([
      { path: 'src/f/a.ts', kind: 'util', imports: [] },
      { path: 'src/f/b.ts', kind: 'util', imports: ['src/f/a.ts'] },
      { path: 'src/f/c.ts', kind: 'util', imports: ['src/f/a.ts'] },
    ]);
    const d = crowdingDigest(crowdingReport(flat, 2), 2);
    expect(d).toContain('no mechanical split found — needs a judgement call');
  });
});
