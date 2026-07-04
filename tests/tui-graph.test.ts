import { describe, it, expect } from 'vitest';
import { blank, serialize, type Screen } from '../src/tui/screen.js';
import { renderGraph, graphFits } from '../src/tui/graph.js';
import { FG } from '../src/tui/draw.js';
import type { ConstellationNode } from '../src/observe/constellation.js';

// renderGraph is now a thin adapter over @facet/core nodeGraph (braille-curved
// edges + `( label )` pills, coloured by hub state), blitted into the pane. The
// widget's own geometry is unit-tested in the facet repo; here we assert the
// adapter wiring: fit predicate, pills + labels, state colour, edges, inset.

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const R = (w: number, h: number) => ({ x: 0, y: 0, w, h });
const N = (id: string, label: string, deps: string[], state: ConstellationNode['state'] = 'idle'): ConstellationNode =>
  ({ id, label, title: '', deps, weight: 0.5, callsNetwork: state === 'err', state });
const HUBS = [N('a.ts', 'alpha', ['b.ts', 'c.ts'], 'active'), N('b.ts', 'beta', []), N('c.ts', 'gamma', [], 'err')];
describe('graphFits', () => {
  it('needs ≥2 nodes and a big enough pane', () => {
    expect(graphFits(R(40, 8), 3)).toBe(true);
    expect(graphFits(R(30, 8), 3)).toBe(false); // too narrow
    expect(graphFits(R(40, 5), 3)).toBe(false); // too short
    expect(graphFits(R(40, 8), 1)).toBe(false); // single node
  });
});

describe('renderGraph (facet nodeGraph adapter)', () => {
  it('draws ( label ) pills coloured by hub state, with edges', () => {
    const s = blank(56, 12);
    renderGraph(s, R(56, 12), HUBS);
    const out = plain(serialize(s));
    expect(out).toContain('( alpha )');
    expect(out).toContain('( beta )');
    expect(out).toContain('( gamma )');
    // an edge trace (box-drawing straight run or braille curve)
    expect(out).toMatch(/[─│┌┐└┘┼]/); // orthogonal box-drawing edge
  });

  it('colours a network/err hub red and an idle hub dim', () => {
    const s = blank(56, 12);
    renderGraph(s, R(56, 12), HUBS); // gamma=err(network) → FG.err; beta=idle → FG.dim
    expect(s.cells.some((c) => c.st.fg === FG.err)).toBe(true);
    expect(s.cells.some((c) => c.st.fg === FG.dim)).toBe(true);
  });

  it('shows only the largest connected component (drops isolated hubs)', () => {
    const s = blank(56, 12);
    renderGraph(s, R(56, 12), [
      N('a', 'alpha', ['b', 'c'], 'active'), N('b', 'beta', []), N('c', 'gamma', []), // connected trio
      N('d', 'delta', []), N('e', 'epsilon', []), // isolated → excluded
    ]);
    const out = plain(serialize(s));
    expect(out).toContain('( alpha )');
    expect(out).toContain('( beta )');
    expect(out).not.toContain('delta'); // isolated hub not rendered
    expect(out).not.toContain('epsilon');
  });

  it('renders inside the pane rect (inset past the frame rail)', () => {
    const s = blank(56, 12);
    renderGraph(s, { x: 0, y: 0, w: 56, h: 12 }, HUBS);
    // nothing drawn on the top row (reserved for the frame border by the caller)
    const topRow = s.cells.slice(0, 56).every((c) => c.ch === ' ');
    expect(topRow).toBe(true);
  });
});
