import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNode, repoMapFor, focusDirective } from '../src/loop/scout.js';
import { runLoop } from '../src/loop/engine.js';
import { profile } from '../src/loop/profiles.js';
import type { ModuleGraph } from '../src/mock/graph.js';
import type { Brain } from '../src/brain/brain.js';

// ---- scout (pure) --------------------------------------------------------
const graph: ModuleGraph = {
  nodes: new Map([
    ['src/quality/analyze.ts', { path: 'src/quality/analyze.ts', kind: 'util', imports: [], callsNetwork: false }],
    ['src/quality/scan.ts', { path: 'src/quality/scan.ts', kind: 'util', imports: ['src/quality/analyze.ts'], callsNetwork: false }],
    ['src/cli/quality.ts', { path: 'src/cli/quality.ts', kind: 'util', imports: ['src/quality/analyze.ts', 'src/quality/scan.ts'], callsNetwork: false }],
  ]),
  order: [],
};

describe('scout.findNode', () => {
  it('matches by exact, suffix, and substring', () => {
    expect(findNode(graph, 'src/quality/analyze.ts')?.path).toBe('src/quality/analyze.ts');
    expect(findNode(graph, 'analyze.ts')?.path).toBe('src/quality/analyze.ts');
    expect(findNode(graph, './src/quality/analyze.ts')?.path).toBe('src/quality/analyze.ts');
    expect(findNode(graph, 'nope.ts')).toBeNull();
  });
});

describe('scout.repoMapFor', () => {
  it('lists the focus file, its imports, and its importers', () => {
    const map = repoMapFor(graph, 'analyze.ts');
    expect(map).toContain('focus: src/quality/analyze.ts');
    expect(map).toContain('imports: (none)');
    expect(map).toContain('src/quality/scan.ts');
    expect(map).toContain('src/cli/quality.ts');
  });
  it('returns empty when the path is unknown', () => {
    expect(repoMapFor(graph, 'ghost.ts')).toBe('');
  });
});

describe('scout.focusDirective', () => {
  it('always emits the FOCUS directive, with the map when a graph is given', () => {
    expect(focusDirective(null, 'x.ts')).toContain('FOCUS');
    expect(focusDirective(graph, 'analyze.ts')).toContain('Repo map');
  });
});

// ---- engine never-edited stop (read-thrash) ------------------------------
/** A brain that ONLY ever reads — a different file each turn (so calls are NOT
 *  circular). Mimics the large-repo refactor read-stall. */
function readOnlyBrain(): Brain {
  let n = 0;
  return {
    id: 'fake',
    model: 'fake',
    async complete() {
      const path = `f${n++}.ts`; // distinct each turn → never "circular"
      return {
        text: '',
        toolCalls: [{ id: `c${n}`, name: 'read_file', input: { path } }],
        stopReason: 'tool_use',
        usage: { input: 1, output: 1, cacheRead: 0 },
      };
    },
  };
}

describe('engine never-edited stall (distinct reads, not circular)', () => {
  it('nudges then stops early instead of churning to max_steps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-stall-'));
    for (let i = 0; i < 40; i++) writeFileSync(join(dir, `f${i}.ts`), `export const x${i} = ${i};\n`);
    process.env.PROBEVANE_EVENTS = '0';
    process.env.PROBEVANE_LEDGER = '0';

    const logs: string[] = [];
    const out = await runLoop({
      workdir: dir,
      adapter: {} as any, // 'bare' profile has no gates → adapter is untouched
      brain: readOnlyBrain(),
      runes: profile('bare', { kind: 'unit' }),
      task: 'refactor something',
      maxSteps: 30,
      forceStopAfter: 8,
      log: (l) => logs.push(l),
    });

    expect(out.stopReason).toBe('difficulty'); // never-edited, fired without circularity
    expect(out.steps).toBeLessThanOrEqual(9); // stopped at forceStopAfter(8), NOT max_steps(30)
    expect(logs.some((l) => l.includes('read-thrash nudge'))).toBe(true); // nudged first
    expect(out.accepted).toBe(false);
  });
});
