// UI perf gate — measures the render hot paths + asserts budgets so a perf
// regression (accidental full-repaint, control.html bloat, a widget going
// O(n²)) fails CI the way parity/snapshot gates catch visual ones. Run via tsx
// (imports .ts source): `npm run bench:ui`.
//
// Two kinds of budget:
//  - DETERMINISTIC (machine-independent, the real signal): the diff-flush byte
//    ratio and control.html size. These don't vary with CI load.
//  - TIMING (coarse backstop, generous ×80+ margin over local): only trips on a
//    catastrophic algorithmic regression, never on a slow CI runner.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const S = join(ROOT, 'src'), E = join(ROOT, 'engine');
const { blank, serialize, diff } = await import(join(S, 'tui/screen.ts'));
const { paintConsole } = await import(join(S, 'tui/screens.ts'));
const { CellPainter } = await import(join(E, 'render-term/src/index.ts'));
const { SvgPainter } = await import(join(E, 'render-dom/src/index.ts'));
const { ENTRIES } = await import(join(E, 'gallery/src/gallery.ts'));

// min-of-batches: the fastest clean run best reflects pure compute (drops GC /
// scheduler noise), so the timing budget can be tight-ish yet non-flaky.
const bench = (iters, fn) => {
  for (let i = 0; i < 50; i++) fn(); // warmup
  let best = Infinity;
  for (let b = 0; b < 8; b++) {
    const t = performance.now();
    for (let i = 0; i < iters; i++) fn();
    best = Math.min(best, (performance.now() - t) / iters);
  }
  return best;
};

const runes = Array.from({ length: 11 }, (_, i) => ({ name: 'rune' + i }));
const pipe = {}; runes.forEach((r, i) => { pipe[r.name] = i < 6 ? 'ok' : 'idle'; });
const hubs = ['a', 'b', 'c', 'd', 'e', 'f'].map((l, i) => ({ id: 'x/' + l, label: l, title: '', deps: i > 0 ? ['x/a'] : [], weight: 1 - i * 0.1, callsNetwork: false, state: 'idle' }));
const snap = { health: {}, totals: { acceptRate: 0.8, runs: 78, totalCost: 12 }, daily: [{ date: 'd', cost: 2, tokensOut: 400 }], jobs: [], runs: [{ runId: 'r', label: 'x', accepted: true }], runes, alerts: [], hubs, projects: [], wikiPages: [], ops: [] };

const consoleFrame = () => { const s = blank(120, 40); paintConsole(s, 120, 40, snap, pipe, { t: 0, reveal: 1 }, 0); return s; };
const frameMs = bench(1000, consoleFrame);
const prev = consoleFrame();
const next = consoleFrame(); next.cells[500] = { ch: 'X', st: { fg: 1 } };
const fullBytes = serialize(next).length;
const diffBytes = diff(prev, next).length;
const diffRatio = diffBytes / fullBytes;
const cellMs = bench(300, () => { for (const e of ENTRIES) { const p = new CellPainter(e.w + 1, Math.max(e.h, 1) + 1); e.draw(p); p.flush(); } });
const svgMs = bench(300, () => { for (const e of ENTRIES) { const p = new SvgPainter(e.w, Math.max(e.h, 1)); e.draw(p); p.toSvg(); } });
const htmlKB = readFileSync(join(S, 'ui/control.html')).length / 1024;

// budget: [label, value, unit, max, kind]
const B = [
  ['console frame build (120x40)', frameMs, 'ms', 15, 'time'],
  ['catalog 44 → cells', cellMs, 'ms', 15, 'time'],
  ['catalog 44 → svg', svgMs, 'ms', 15, 'time'],
  ['diff-flush ratio (1-cell change)', diffRatio * 100, '% of full', 3, 'det'],
  ['control.html size', htmlKB, 'kB', 96, 'det'], // 80→88 Assistant tab; →94 history; →96 readability + transcript clamp/calm
];
let failed = 0;
console.log('[bench:ui]');
for (const [label, val, unit, max, kind] of B) {
  const ok = val <= max;
  if (!ok) failed++;
  const tag = kind === 'det' ? 'DET ' : 'time';
  console.log(`  ${ok ? 'ok ' : 'XX '} ${tag} ${label.padEnd(34)} ${val.toFixed(kind === 'det' ? 2 : 3).padStart(8)} ${unit.padEnd(9)} (max ${max})`);
}
if (failed) { console.error(`[bench:ui] ${failed} budget(s) exceeded`); process.exit(1); }
console.log('[bench:ui] all budgets green');
