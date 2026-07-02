import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reactAdapter } from '../src/adapters/react-vitest-playwright/index.js';
import { discoverReact } from '../src/adapters/react-vitest-playwright/discover.js';
import type { TestTarget } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping (same helpers as cov-adapters*.test.ts) ---------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmutreact-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function write(dir: string, rel: string, contents: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// =========================================================================
// MUTANT — index.ts:32
//   `return target.kind === 'unit' ? probeReactUnit(...) : probeReactE2e(...)`
//   (=== → !==) swaps the two probes.
// The unit probe and the e2e probe produce OBSERVABLY different shapes:
//   unit → per-file "GROUND TRUTH for <path>" digest + facts.components
//   e2e  → app-wide "UI inventory" digest + facts.headings/buttonText/routes
// So `probe({kind:'unit'})` must yield the unit shape and vice versa.
// =========================================================================
describe('reactAdapter.probe — dispatches by kind (kills === → !==)', () => {
  it('kind:unit returns the UNIT probe shape (per-file ground truth)', async () => {
    const d = tmp();
    write(
      d,
      'src/Button.tsx',
      'export function Button() { return <button aria-label="go">hi</button>; }',
    );
    const target: TestTarget = { kind: 'unit', sourcePath: 'src/Button.tsx', name: 'Button' };
    const r = await reactAdapter.probe(d, target);
    // Unit-only markers:
    expect(r.digest).toContain('GROUND TRUTH for src/Button.tsx');
    expect(r.facts.components).toContain('Button');
    // e2e markers must be ABSENT (mutant would run probeReactE2e here):
    expect(r.digest).not.toContain('UI inventory');
    expect(r.facts.buttonText).toBeUndefined();
  });

  it('kind:e2e returns the E2E probe shape (app-wide UI inventory)', async () => {
    const d = tmp();
    write(
      d,
      'src/App.tsx',
      `export default function App() {
  return (
    <div>
      <h1>Dashboard</h1>
      <button aria-label="logout">Log out</button>
    </div>
  );
}`,
    );
    const target: TestTarget = { kind: 'e2e', sourcePath: 'src', name: 'app' };
    const r = await reactAdapter.probe(d, target);
    // e2e-only markers:
    expect(r.digest).toContain('UI inventory');
    expect(r.facts.buttonText).toContain('Log out');
    expect(r.facts.headings).toContain('Dashboard');
    // unit markers must be ABSENT (mutant would run probeReactUnit here):
    expect(r.digest).not.toContain('GROUND TRUTH for src');
    expect(r.facts.components).toBeUndefined();
  });
});

// =========================================================================
// MUTANT — index.ts:46
//   `return loadPrompt(kind === 'unit' ? 'unit-patterns.md' : 'e2e-patterns.md')`
//   (=== → !==) swaps which pattern doc patternsDoc() loads.
// The two docs have distinct headings, so assert each kind loads its own doc.
// (guidance()'s branch at :40 is already covered in cov-mut-adapters.test.ts;
//  this targets patternsDoc()'s loadPrompt branch.)
// =========================================================================
describe('reactAdapter.patternsDoc — loads the right doc per kind (kills === → !==)', () => {
  it('unit kind loads unit-patterns.md', async () => {
    const doc = await reactAdapter.patternsDoc('unit');
    expect(doc).toContain('# Unit patterns'); // from unit-patterns.md
    expect(doc).not.toContain('# E2E patterns'); // e2e doc would leak on a swap
  });

  it('e2e kind loads e2e-patterns.md', async () => {
    const doc = await reactAdapter.patternsDoc('e2e');
    expect(doc).toContain('# E2E patterns'); // from e2e-patterns.md
    expect(doc).not.toContain('# Unit patterns');
  });
});

// =========================================================================
// MUTANT — discover.ts:10
//   `if (!/\.(tsx|ts|jsx|js)$/.test(f)) return true`  (skip non-source)
//   (true → false) would stop skipping non-source files, letting a .css/.json
//   through into the discovered targets. baseName() only strips [tj]sx?
//   extensions, so a leaked 'data.json' keeps its full name.
// =========================================================================
describe('discoverReact — non-source files are excluded (kills true → false)', () => {
  it('a .css and a .json file never become targets', async () => {
    const d = tmp();
    write(d, 'src/Widget.tsx', 'export function Widget() { return <div/>; }');
    write(d, 'src/styles.css', 'body{}'); // must be skipped (non-source)
    write(d, 'src/data.json', '{"a":1}'); // must be skipped (non-source)
    const names = (await discoverReact(d, 'unit')).map((t) => t.name);
    expect(names).toContain('Widget');
    expect(names).not.toContain('styles.css'); // mutant would surface this
    expect(names).not.toContain('data.json'); // mutant would surface this
  });
});

// =========================================================================
// MUTANTS — discover.ts:21/22/23 — the cost WEIGHTS (all + → -)
//   :21  redux-bound   cost += 3
//   :22  router-bound  cost += 2
//   :23  context-using  cost += 1
// discover exposes per-module cost at meta.cost. Each fixture is a plain
// non-component .ts module whose ONLY difference from a baseline module is
// the one signal under test, so the observed cost delta equals that exact
// weight. `+ → -` negates the weight, flipping the delta's sign.
// =========================================================================
describe('discoverReact — per-signal cost weights (kills + → - on :21/:22/:23)', () => {
  // All four modules are plain arrow-const .ts exports → identical baseline
  // (the `^export (const|function) \w+ =` rule contributes -1 to each equally),
  // isolating each hook signal's contribution.
  function buildSignals(d: string) {
    write(d, 'src/plain.ts', 'export const plain = () => { return 1; };');
    write(d, 'src/redux.ts', 'export const redux = () => { useSelector(); return 1; };');
    write(d, 'src/router.ts', 'export const router = () => { useNavigate(); return 1; };');
    write(d, 'src/context.ts', 'export const context = () => { useContext(X); return 1; };');
  }
  async function costs(d: string): Promise<(n: string) => number> {
    const targets = await discoverReact(d, 'unit');
    return (n: string) => (targets.find((t) => t.name === n)!.meta as any).cost as number;
  }

  it(':21 redux-bound module costs exactly +3 over the plain baseline', async () => {
    const d = tmp();
    buildSignals(d);
    const cost = await costs(d);
    expect(cost('redux')).toBe(cost('plain') + 3); // mutant `-3` → plain-3 (kills)
    expect(cost('redux')).toBeGreaterThan(cost('plain'));
  });

  it(':22 router-bound module costs exactly +2 over the plain baseline', async () => {
    const d = tmp();
    buildSignals(d);
    const cost = await costs(d);
    expect(cost('router')).toBe(cost('plain') + 2); // mutant `-2` → plain-2 (kills)
    expect(cost('router')).toBeGreaterThan(cost('plain'));
  });

  it(':23 context-using module costs exactly +1 over the plain baseline', async () => {
    const d = tmp();
    buildSignals(d);
    const cost = await costs(d);
    expect(cost('context')).toBe(cost('plain') + 1); // mutant `-1` → plain-1 (kills)
    expect(cost('context')).toBeGreaterThan(cost('plain'));
  });
});
