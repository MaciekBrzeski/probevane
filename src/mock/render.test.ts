import { describe, it, expect } from 'vitest';
import { toAscii, sharedModules } from './render.js';
import type { ModuleGraph, ModuleNode } from './graph.js';

function graph(nodes: (Pick<ModuleNode, 'path' | 'kind'> & Partial<Pick<ModuleNode, 'imports' | 'callsNetwork'>>)[]): ModuleGraph {
  const map = new Map(nodes.map((n) => [n.path, { ...n, imports: n.imports ?? [], callsNetwork: n.callsNetwork ?? false }]));
  return { nodes: map, order: [...map.keys()] };
}

describe('sharedModules', () => {
  it('returns modules imported by >= minImporters other in-graph modules, sorted by count desc then path asc', () => {
    const g = graph([
      { path: 'src/app.ts', kind: 'component', imports: ['src/lib/a.ts', 'src/lib/b.ts', 'src/lib/c.ts'] },
      { path: 'src/page.ts', kind: 'component', imports: ['src/lib/a.ts', 'src/lib/b.ts'] },
      { path: 'src/lib/a.ts', kind: 'util' },
      { path: 'src/lib/b.ts', kind: 'util' },
      { path: 'src/lib/c.ts', kind: 'util' },
    ]);
    expect(sharedModules(g, 2)).toEqual([
      { path: 'src/lib/a.ts', importedBy: 2 },
      { path: 'src/lib/b.ts', importedBy: 2 },
    ]);
  });

  it('defaults minImporters to 8 and excludes modules below the threshold', () => {
    const nodes: Pick<ModuleNode, 'path' | 'kind' | 'imports'>[] = [];
    for (let i = 0; i < 10; i++) nodes.push({ path: `src/consumer${i}.ts`, kind: 'util', imports: ['src/shared.ts'] });
    nodes.push({ path: 'src/shared.ts', kind: 'util', imports: [] });
    for (let i = 0; i < 7; i++) nodes.push({ path: `src/rc${i}.ts`, kind: 'util', imports: ['src/rare.ts'] });
    nodes.push({ path: 'src/rare.ts', kind: 'util', imports: [] });
    expect(sharedModules(graph(nodes))).toEqual([{ path: 'src/shared.ts', importedBy: 10 }]);
  });

  it('sorts ties by path ascending', () => {
    const g = graph([
      { path: 'src/z.ts', kind: 'util' }, { path: 'src/a.ts', kind: 'util' }, { path: 'src/m.ts', kind: 'util' },
      { path: 'src/app.ts', kind: 'component', imports: ['src/z.ts', 'src/a.ts', 'src/m.ts'] },
    ]);
    expect(sharedModules(g, 1)).toEqual([
      { path: 'src/a.ts', importedBy: 1 }, { path: 'src/m.ts', importedBy: 1 }, { path: 'src/z.ts', importedBy: 1 },
    ]);
  });

  it('ignores imports of out-of-graph modules (only in-graph targets are counted)', () => {
    const g = graph([
      { path: 'src/app.ts', kind: 'component', imports: ['src/shared.ts', 'src/external.ts'] },
      { path: 'src/shared.ts', kind: 'util' },
    ]);
    // external.ts is not a node → never counted; shared.ts has 1 in-graph importer.
    expect(sharedModules(g, 1)).toEqual([{ path: 'src/shared.ts', importedBy: 1 }]);
  });

  it('returns an empty array when the graph is empty or nothing meets the threshold', () => {
    expect(sharedModules(graph([]))).toEqual([]);
    const g = graph([{ path: 'src/app.ts', kind: 'component', imports: ['src/lib.ts'] }, { path: 'src/lib.ts', kind: 'util' }]);
    expect(sharedModules(g, 2)).toEqual([]);
  });
});

describe('toAscii', () => {
  it('without opts keeps the current behavior (incl. the ↺ revisit marker)', () => {
    const g = graph([
      { path: 'src/app.ts', kind: 'component', imports: ['src/lib/a.ts', 'src/lib/b.ts'] },
      { path: 'src/lib/a.ts', kind: 'util', imports: ['src/lib/b.ts'] },
      { path: 'src/lib/b.ts', kind: 'util' },
    ]);
    expect(toAscii(g)).toBe(['🧩 app.ts', '├─ ⚙️ lib/a.ts', '│  └─ ⚙️ lib/b.ts', '└─ ⚙️ lib/b.ts ↺'].join('\n'));
    expect(toAscii(g, {})).toBe(toAscii(g)); // collapseHubs undefined = unchanged
  });

  it('collapses a hub subtree (not re-expanded) and appends the shared footer', () => {
    // hub imported by app + leaf = 2 → hub; its dep `deep` must NOT be drawn.
    const g = graph([
      { path: 'src/app.ts', kind: 'component', imports: ['src/lib/hub.ts', 'src/lib/leaf.ts'] },
      { path: 'src/lib/leaf.ts', kind: 'util', imports: ['src/lib/hub.ts'] },
      { path: 'src/lib/hub.ts', kind: 'util', imports: ['src/lib/deep.ts'] },
      { path: 'src/lib/deep.ts', kind: 'util' },
    ]);
    expect(toAscii(g, { collapseHubs: 2 })).toBe([
      '🧩 app.ts',
      '├─ ⚙️ lib/hub.ts ⇗ shared',
      '└─ ⚙️ lib/leaf.ts',
      '   └─ ⚙️ lib/hub.ts ⇗ shared',
      '',
      'Shared (imported by >=2):',
      'lib/hub.ts (2)',
    ].join('\n'));
    expect(toAscii(g, { collapseHubs: 2 })).not.toContain('deep'); // subtree collapsed away
  });

  it('sorts the shared footer by importedBy descending then path ascending', () => {
    const g = graph([
      { path: 'src/c1.ts', kind: 'component', imports: ['src/lib/a.ts'] },
      { path: 'src/c2.ts', kind: 'component', imports: ['src/lib/a.ts', 'src/lib/b.ts'] },
      { path: 'src/c3.ts', kind: 'component', imports: ['src/lib/a.ts', 'src/lib/b.ts'] },
      { path: 'src/lib/a.ts', kind: 'util' }, { path: 'src/lib/b.ts', kind: 'util' },
    ]);
    const footer = toAscii(g, { collapseHubs: 2 }).split('Shared (imported by >=2):\n')[1];
    expect(footer).toBe(['lib/a.ts (3)', 'lib/b.ts (2)'].join('\n')); // a(3) before b(2)
  });

  it('appends no footer when no module meets the threshold', () => {
    const g = graph([
      { path: 'src/app.ts', kind: 'component', imports: ['src/lib/a.ts', 'src/lib/b.ts'] },
      { path: 'src/lib/a.ts', kind: 'util', imports: ['src/lib/b.ts'] },
      { path: 'src/lib/b.ts', kind: 'util' },
    ]);
    expect(toAscii(g, { collapseHubs: 5 })).toBe(toAscii(g));
    expect(toAscii(g, { collapseHubs: 5 })).not.toContain('Shared (imported by');
  });

  it('preserves the network marker on a collapsed hub (and shows ⇗ shared, not ↺)', () => {
    const g = graph([
      { path: 'src/app.ts', kind: 'component', imports: ['src/lib/hub.ts', 'src/lib/leaf.ts'] },
      { path: 'src/lib/leaf.ts', kind: 'util', imports: ['src/lib/hub.ts'] },
      { path: 'src/lib/hub.ts', kind: 'fetcher', callsNetwork: true },
    ]);
    expect(toAscii(g, { collapseHubs: 2 })).toBe([
      '🧩 app.ts',
      '├─ 🌐 lib/hub.ts 🌐net ⇗ shared',
      '└─ ⚙️ lib/leaf.ts',
      '   └─ 🌐 lib/hub.ts 🌐net ⇗ shared',
      '',
      'Shared (imported by >=2):',
      'lib/hub.ts (2)',
    ].join('\n'));
  });
});
