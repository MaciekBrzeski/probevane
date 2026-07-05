import { describe, it, expect } from 'vitest';
import { constellation, type GraphNode } from '../src/observe/constellation.js';

const N = (path: string, imports: string[], fanIn: number, callsNetwork = false): GraphNode => ({ path, imports, fanIn, callsNetwork });

describe('constellation (shared hub selection)', () => {
  it('keeps top fan-in hubs that are connected, drops isolated nodes', () => {
    const out = constellation([
      N('src/engine.ts', ['src/adapter.ts'], 5),
      N('src/adapter.ts', [], 3, true),
      N('src/lonely.ts', [], 1), // nobody imports it, imports nothing in-pool → dropped
    ]);
    expect(out.map((n) => n.id)).toEqual(['src/engine.ts', 'src/adapter.ts']);
    expect(out.find((n) => n.id === 'src/lonely.ts')).toBeUndefined();
  });

  it('derives label (basename, no ext), weight (fan-in / max), deps (kept only), and state', () => {
    const [engine, adapter] = constellation([
      N('src/engine.ts', ['src/adapter.ts', 'node:fs'], 5),
      N('src/adapter.ts', [], 3, true),
    ]);
    expect(engine).toMatchObject({ label: 'engine', weight: 1, state: 'active', deps: ['src/adapter.ts'] });
    expect(engine.deps).not.toContain('node:fs'); // dep outside the kept set is filtered
    expect(adapter).toMatchObject({ label: 'adapter', callsNetwork: true, state: 'err' }); // network caller → err
    expect(adapter.weight).toBeCloseTo(0.6); // 3 / 5
  });

  it('a low-fan-in connected node is idle, not active', () => {
    const out = constellation([
      N('a.ts', ['b.ts'], 10),
      N('b.ts', ['a.ts'], 2), // weight 0.2 ≤ 0.5 → idle
    ]);
    expect(out.find((n) => n.id === 'b.ts')!.state).toBe('idle');
  });

  it('empty graph → empty', () => {
    expect(constellation([])).toEqual([]);
  });
});
