import { describe, it, expect } from 'vitest';
import { layoutDag, chainToDag } from '../src/ui/app/layout.ts';

// Pure DAG layout for the console graphs — deterministic, no physics.
describe('layoutDag', () => {
  it('layers by longest path from roots; edges point dep → dependent', () => {
    const l = layoutDag([
      { id: 'a', deps: [] },
      { id: 'b', deps: ['a'] },
      { id: 'c', deps: ['a', 'b'] }, // longest path via b → layer 2
    ]);
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(at('a').layer).toBe(0);
    expect(at('b').layer).toBe(1);
    expect(at('c').layer).toBe(2);
    expect(at('b').x).toBeGreaterThan(at('a').x);
    expect(l.edges).toContainEqual({ from: 'a', to: 'b' });
  });

  it('is deterministic and tolerates cycles + unknown deps', () => {
    const input = [
      { id: 'x', deps: ['y', 'ghost'] },
      { id: 'y', deps: ['x'] }, // cycle
    ];
    const a = layoutDag(input);
    const b = layoutDag(input);
    expect(a).toEqual(b);
    expect(a.edges.every((e) => e.from !== 'ghost')).toBe(true);
    expect(a.width).toBeGreaterThan(0);
    expect(a.height).toBeGreaterThan(0);
  });

  it('separates same-layer nodes vertically', () => {
    const l = layoutDag([
      { id: 'root', deps: [] },
      { id: 'l1', deps: ['root'] },
      { id: 'l2', deps: ['root'] },
    ]);
    const [p, q] = ['l1', 'l2'].map((id) => l.nodes.find((n) => n.id === id)!);
    expect(p.x).toBe(q.x);
    expect(p.y).not.toBe(q.y);
  });

  it('chainToDag builds the rune pipeline shape', () => {
    const dag = chainToDag(['plan', 'validate', 'accept']);
    expect(dag[0].deps).toEqual([]);
    expect(dag[2].deps).toEqual(['validate']);
    const l = layoutDag(dag);
    expect(l.nodes.map((n) => n.layer)).toEqual([0, 1, 2]);
  });
});
