import { describe, it, expect } from 'vitest';
import { layoutDag, chainToDag, type LayoutNode } from '../src/layout';

describe('layoutDag', () => {
  it('layers by longest path (roots left, dependents right)', () => {
    const g: LayoutNode[] = [
      { id: 'a', deps: [] },
      { id: 'b', deps: ['a'] },
      { id: 'c', deps: ['b'] },
    ];
    const byId = Object.fromEntries(layoutDag(g, { colGap: 1, rowGap: 1, pad: 0 }).nodes.map((n) => [n.id, n]));
    expect(byId.a!.layer).toBe(0);
    expect(byId.b!.layer).toBe(1);
    expect(byId.c!.layer).toBe(2);
  });

  it('emits edges dep→dependent and drops edges to unknown ids', () => {
    const lay = layoutDag([
      { id: 'a', deps: [] },
      { id: 'b', deps: ['a', 'ghost'] },
    ]);
    expect(lay.edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('orders siblings within a layer by mean parent row', () => {
    // a,c on layer 0; b deps a, d deps c → b,d layer 1 keep parents order.
    const lay = layoutDag([
      { id: 'a', deps: [] }, { id: 'c', deps: [] },
      { id: 'b', deps: ['a'] }, { id: 'd', deps: ['c'] },
    ], { colGap: 1, rowGap: 1, pad: 0 });
    const y = Object.fromEntries(lay.nodes.map((n) => [n.id, n.y]));
    expect(y.a).not.toBe(y.c); // stacked in column 0
    expect(y.b).toBe(y.a);     // b sits at its parent's row
    expect(y.d).toBe(y.c);
  });

  it('is deterministic — same input, same output', () => {
    const g: LayoutNode[] = [{ id: 'x', deps: [] }, { id: 'y', deps: ['x'] }];
    expect(layoutDag(g)).toEqual(layoutDag(g));
  });
});

describe('layoutDag edge cases', () => {
  it('does not diverge on a cycle (layers clamp at |V|)', () => {
    const lay = layoutDag([{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['a'] }]);
    expect(lay.nodes).toHaveLength(2);
    for (const n of lay.nodes) expect(n.layer).toBeLessThan(2);
  });
  it('handles multiple roots + a node whose dep sits in a later layer', () => {
    const lay = layoutDag([
      { id: 'r1', deps: [] }, { id: 'r2', deps: [] },
      { id: 'mid', deps: ['r1'] }, { id: 'leaf', deps: ['mid', 'r2'] },
    ], { colGap: 1, rowGap: 1, pad: 0 });
    const byId = Object.fromEntries(lay.nodes.map((n) => [n.id, n]));
    expect(byId.leaf!.layer).toBe(2); // longest path r1→mid→leaf
    expect(byId.r1!.layer).toBe(0);
  });
  it('empty graph → empty layout', () => {
    expect(layoutDag([]).nodes).toEqual([]);
  });
});

describe('chainToDag', () => {
  it('turns an id list into a straight chain', () => {
    expect(chainToDag(['p', 'q', 'r'])).toEqual([
      { id: 'p', deps: [] },
      { id: 'q', deps: ['p'] },
      { id: 'r', deps: ['q'] },
    ]);
  });
  it('empty → empty', () => {
    expect(chainToDag([])).toEqual([]);
  });
});
