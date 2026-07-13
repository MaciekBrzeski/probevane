// SINGLE SOURCE OF TRUTH for the control center's visual model. Consumed by
// BOTH renderers — the browser (DOM / CSS custom-props / SVG) and the terminal
// (ANSI / cell rects). Each renderer is a thin adapter over this model:
//
//   browser  ⇠  theme.ts  ⇢  terminal
//   :root vars, <Tabs>,      draw.ts FG, tabs.ts,
//   ConsolePanel grid        screens.ts rects
//
// Edit a colour / tab / console region here and it changes in both places.

export const PALETTE = {
  bg: '#04070f', panel: '#0b1220', line: '#1b2a44', fg: '#cfe3f5', dim: '#7d93ad',
  ok: '#2fe6a8', warn: '#ffb454', err: '#ff5d6c', acc: '#4fd6ff', mag: '#c792ea',
} as const;
/** A palette key — themed surfaces name colours by this, never by raw hex. */
export type ColorName = keyof typeof PALETTE;

/** Packed 0xRRGGBB for the terminal renderer (draw.ts). */
export const packed = (n: ColorName): number => parseInt(PALETTE[n].slice(1), 16);

/** `var(--acc)` for the browser renderer. */
export const cssVar = (n: ColorName): string => `var(--${n})`;

/** The `:root` custom-property map the browser applies at boot (SSOT → CSS). */
export function cssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const k of Object.keys(PALETTE) as ColorName[]) vars[`--${k}`] = PALETTE[k];
  vars['--warn2'] = PALETTE.warn; // legacy alias used in a few CSS rules
  vars['--frame'] = PALETTE.acc;
  return vars;
}

const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);

// --- tabs -------------------------------------------------------------------
export interface TabDef {
  id: string;
  title: string;      // browser tab-strip label
  accent: ColorName;  // frame/lamp accent
  terminal: boolean;  // rendered by the TUI too (subset the terminal supports)
}
export const TABS: TabDef[] = [
  { id: 'projects', title: 'Projects', accent: 'acc', terminal: true },
  { id: 'runs', title: 'Runs', accent: 'mag', terminal: true },
  { id: 'docs', title: 'Docs', accent: 'acc', terminal: true },
  { id: 'launch', title: 'Launch', accent: 'acc', terminal: true },
  { id: 'cost', title: 'Cost / Alerts', accent: 'warn', terminal: true },
  { id: 'quality', title: 'Quality', accent: 'ok', terminal: true },
  { id: 'console', title: 'Console', accent: 'acc', terminal: true },
  { id: 'terminal', title: 'Terminal', accent: 'acc', terminal: true },
];
/** The tabs the terminal control center renders (now full parity — every browser tab), in browser order. */
export const TERMINAL_TABS: TabDef[] = TABS.filter((t) => t.terminal);

// --- telemetry gauges -------------------------------------------------------
export interface GaugeSpec { id: string; label: string; value: number; raw: string; accent: ColorName }
// The telemetry gauge row (acceptance %, run count vs budget) both renderers draw.
export function gauges(totals: { acceptRate?: number; runs?: number }): GaugeSpec[] {
  const acc = totals.acceptRate ?? 0, runs = totals.runs ?? 0;
  return [
    { id: 'accept', label: 'acceptance', value: clamp01(acc), raw: `${Math.round(acc * 100)}%`, accent: 'ok' },
    { id: 'runs', label: 'runs / 500', value: Math.min(1, runs / 500), raw: String(runs), accent: 'warn' },
  ];
}

// --- run-history columns ----------------------------------------------------
// One column schema for the run list — the browser renders it as a <table>, the
// terminal as aligned text columns (fit/shed on narrow widths). Same columns,
// same order, same accessors; only the cell chrome differs per medium.
export interface RunView {
  ts?: string; label?: string; runId?: string; model?: string;
  accepted?: boolean; stopReason?: string; cost?: number; steps?: number;
}
/** One run-list column: header, width/grow, and the cell accessor — shared by both renderers. */
export interface RunColumn {
  id: string; header: string; w: number; // w = fixed width (min width for the grow column)
  grow?: boolean; align?: 'l' | 'r'; muted?: boolean; get: (r: RunView) => string;
}
export const RUN_COLUMNS: RunColumn[] = [
  { id: 'when', header: 'when', w: 19, muted: true, get: (r) => (r.ts || '').slice(0, 19).replace('T', ' ') },
  { id: 'label', header: 'label', w: 16, grow: true, get: (r) => r.label || r.runId || '' },
  { id: 'model', header: 'model', w: 8, muted: true, get: (r) => r.model || '' },
  { id: 'status', header: 'status', w: 10, get: (r) => (r.accepted ? 'accepted' : r.stopReason || '?') },
  { id: 'cost', header: 'cost', w: 6, align: 'r', muted: true, get: (r) => '$' + (r.cost ?? 0) },
  { id: 'steps', header: 'steps', w: 6, align: 'r', muted: true, get: (r) => String(r.steps ?? '') },
];
/** Order the terminal sheds columns when the pane is too narrow (label + status always kept). */
export const RUN_COLUMN_DROP = ['steps', 'cost', 'model', 'when'];

// --- tab layouts ------------------------------------------------------------
// Region manifests — the SAME layout engine for EVERY tab. A span is
// [x0,y0,x1,y1] as fractions of the tab body (0..1). One manifest per tab → the
// terminal builds cell rects (spanToBox); the console one ALSO drives the
// browser grid (spanToCss). No hand-rolled per-tab layout math anywhere.
export interface PaneDef { id: string; title: string; accent: ColorName; span: [number, number, number, number] }
export const LAYOUTS: Record<string, PaneDef[]> = {
  // pipeline hero across the top, telemetry + constellation across the bottom
  console: [
    { id: 'pipeline', title: 'run pipeline', accent: 'acc', span: [0, 0, 1, 0.5] },
    { id: 'telemetry', title: 'telemetry', accent: 'warn', span: [0, 0.5, 0.5, 1] },
    { id: 'constellation', title: 'module constellation', accent: 'mag', span: [0.5, 0.5, 1, 1] },
  ],
  // run list (left) + alerts (right)
  runs: [
    { id: 'jobs', title: 'runs', accent: 'mag', span: [0, 0, 0.6, 1] },
    { id: 'alerts', title: 'alerts', accent: 'warn', span: [0.6, 0, 1, 1] },
  ],
  // cost (left) + alerts over telemetry (right)
  cost: [
    { id: 'cost', title: 'cost / day', accent: 'acc', span: [0, 0, 0.5, 1] },
    { id: 'alerts', title: 'alerts', accent: 'warn', span: [0.5, 0, 1, 0.5] },
    { id: 'telemetry', title: 'telemetry', accent: 'warn', span: [0.5, 0.5, 1, 1] },
  ],
  // project cards, full width
  projects: [{ id: 'projects', title: 'projects', accent: 'acc', span: [0, 0, 1, 1] }],
  // wiki page list (left) + selected page body (right) — mirrors the browser Docs split
  docs: [
    { id: 'pages', title: 'docs', accent: 'acc', span: [0, 0, 0.3, 1] },
    { id: 'page', title: 'page', accent: 'acc', span: [0.3, 0, 1, 1] },
  ],
  // launch form: ops (left) + hint/recent (right)
  launch: [
    { id: 'ops', title: 'operations', accent: 'acc', span: [0, 0, 0.4, 1] },
    { id: 'launchHint', title: 'launch', accent: 'acc', span: [0.4, 0, 1, 1] },
  ],
  // source-quality scorecard, full width
  quality: [{ id: 'quality', title: 'quality', accent: 'ok', span: [0, 0, 1, 1] }],
  // embedded-shell hint, full width
  terminal: [{ id: 'terminal', title: 'terminal', accent: 'acc', span: [0, 0, 1, 1] }],
};
/** The browser console grid consumes this (the one layout that's a grid in both renderers). */
export const CONSOLE_PANES: PaneDef[] = LAYOUTS.console;

/** A concrete cell/pixel rect — spanToBox's output, consumed by both renderers. */
export interface Box { x: number; y: number; w: number; h: number }
/** Map a fractional span into a concrete box inside `area` (both renderers use this). */
export function spanToBox(span: [number, number, number, number], area: Box): Box {
  const [x0, y0, x1, y1] = span;
  const x = area.x + Math.round(x0 * area.w);
  const y = area.y + Math.round(y0 * area.h);
  return { x, y, w: area.x + Math.round(x1 * area.w) - x, h: area.y + Math.round(y1 * area.h) - y };
}
// Absolute-inset CSS for the browser — the SAME span math the engine ships,
// so it's re-exported from @facet/core (spanToBox keeps its cell-rounding here).
export { spanToCss } from '@facet/core';
