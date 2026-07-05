// Facet component library — every widget authored ONCE against Painter, shown
// with a live SVG + cell preview and a copy-pasteable usage snippet (a MUI-style
// catalog). Pure string builder (no DOM), so it runs + tests in node.

import type { Painter } from '@facet/core';
import {
  frame, gauge, sparkline, nodeGraph,
  button, badge, progress, spinner, list, table, tabs, keyValue,
  checkbox, radio, toggle, slider, textField, select,
  alert, banner, tooltip, dialog,
  avatar, chip, card, divider, stat, accordion, tree, timeline,
  breadcrumb, pagination, stepper, menu,
  barChart, donut, heatmap, legend, meter, buttonGroup, rating,
  skeleton, emptyState, scrollbar,
} from '@facet/core';
import { SvgPainter } from '@facet/render-dom';
import { CellPainter } from '@facet/render-term';
import { cellHtml } from './cell-html';

const PAL = {
  bg: 0x04070f, panel: 0x0b1220, line: 0x1b2a44, fg: 0xcfe3f5, dim: 0x7d93ad,
  ok: 0x2fe6a8, warn: 0xffb454, err: 0xff5d6c, acc: 0x4fd6ff, mag: 0xc792ea,
};

const NODES = [
  { id: 'args', label: 'args', deps: ['git', 'valid'], accent: PAL.acc },
  { id: 'exec', label: 'exec', deps: ['valid'], accent: PAL.err },
  { id: 'git', label: 'git', deps: [], accent: PAL.dim },
  { id: 'valid', label: 'valid', deps: [], accent: PAL.ok },
];

export interface Entry { name: string; group: string; desc: string; usage: string; w: number; h: number; draw: (p: Painter) => void }

export const ENTRIES: Entry[] = [
  {
    name: 'frame', group: 'layout', desc: 'LCARS panel: filled card, accent rail, letter-spaced title.',
    usage: `frame(p, { x, y, w, h }, { title: 'telemetry', accent, panel, line })`,
    w: 46, h: 5, draw: (p) => frame(p, { x: 0, y: 0, w: 46, h: 5 }, { title: 'telemetry', accent: PAL.acc, panel: PAL.panel, line: PAL.line }),
  },
  {
    name: 'gauge', group: 'data', desc: 'Ring gauge (value 0..1) with a centred %.',
    usage: `gauge(p, { cx, cy, r, value: 0.71, accent, track })`,
    w: 16, h: 16, draw: (p) => gauge(p, { cx: 8, cy: 8, r: 6, value: 0.71, accent: PAL.ok, track: PAL.line }),
  },
  {
    name: 'sparkline', group: 'data', desc: 'Value trend; optional gradient area.',
    usage: `sparkline(p, { rect, points, accent, area: true })`,
    w: 32, h: 6, draw: (p) => sparkline(p, { rect: { x: 1, y: 0, w: 30, h: 5 }, points: [1, 3, 2, 5, 4, 6, 3, 7, 5, 8], accent: PAL.acc, area: true }),
  },
  {
    name: 'progress', group: 'data', desc: 'Horizontal bar, value 0..1.',
    usage: `progress(p, { rect, value: 0.6, accent, track })`,
    w: 24, h: 1, draw: (p) => progress(p, { rect: { x: 0, y: 0, w: 24, h: 1 }, value: 0.6, accent: PAL.ok, track: PAL.line }),
  },
  {
    name: 'nodeGraph', group: 'data', desc: 'Layered DAG (layoutDag) — pills + edges.',
    usage: `nodeGraph(p, { rect, nodes, edge })`,
    w: 46, h: 10, draw: (p) => nodeGraph(p, { rect: { x: 0, y: 0, w: 46, h: 10 }, edge: PAL.line, nodes: NODES }),
  },
  {
    name: 'button', group: 'controls', desc: 'Labelled box; `filled` inverts.',
    usage: `button(p, { rect, label: 'RUN', accent, fg, filled: true })`,
    w: 14, h: 3, draw: (p) => button(p, { rect: { x: 0, y: 0, w: 12, h: 3 }, label: 'RUN', accent: PAL.acc, fg: PAL.bg, filled: true }),
  },
  {
    name: 'badge', group: 'controls', desc: 'Small filled count / status pill.',
    usage: `badge(p, { x, y, text: '12', accent, fg })`,
    w: 6, h: 2, draw: (p) => badge(p, { x: 0, y: 1, text: '12', accent: PAL.err, fg: PAL.fg }),
  },
  {
    name: 'spinner', group: 'controls', desc: 'Braille spinner; `t` drives the frame.',
    usage: `spinner(p, { x, y, accent }, t)`,
    w: 3, h: 1, draw: (p) => spinner(p, { x: 0, y: 0, accent: PAL.acc }, 240),
  },
  {
    name: 'tabs', group: 'nav', desc: 'Horizontal tab strip; active gets » «.',
    usage: `tabs(p, { x, y, tabs, active, accent, dim })`,
    w: 30, h: 1, draw: (p) => tabs(p, { x: 0, y: 0, tabs: ['runs', 'cost', 'docs'], active: 0, accent: PAL.acc, dim: PAL.dim }),
  },
  {
    name: 'list', group: 'collections', desc: 'Vertical list; selected row marked ▸.',
    usage: `list(p, { rect, items, selected, accent, dim })`,
    w: 16, h: 3, draw: (p) => list(p, { rect: { x: 0, y: 0, w: 16, h: 3 }, items: ['alpha', 'beta', 'gamma'], selected: 1, accent: PAL.acc, dim: PAL.dim }),
  },
  {
    name: 'table', group: 'collections', desc: 'Header + rows in fixed columns.',
    usage: `table(p, { rect, columns, rows, accent, dim, fg })`,
    w: 28, h: 3, draw: (p) => table(p, { rect: { x: 0, y: 0, w: 28, h: 3 }, columns: [{ header: 'name', width: 8 }, { header: 'val', width: 6 }], rows: [['exec', '3'], ['rune', '5']], accent: PAL.acc, dim: PAL.dim, fg: PAL.fg }),
  },
  {
    name: 'keyValue', group: 'collections', desc: 'Aligned key/value rows.',
    usage: `keyValue(p, { rect, pairs, keyW, accent, dim })`,
    w: 20, h: 2, draw: (p) => keyValue(p, { rect: { x: 0, y: 0, w: 20, h: 2 }, pairs: [{ k: 'cost', v: '$10.80' }, { k: 'accept', v: '71%' }], keyW: 9, accent: PAL.ok, dim: PAL.dim }),
  },

  {
    name: 'checkbox', group: 'inputs', desc: 'Checkbox + label; checked in accent.',
    usage: `checkbox(p, { x, y, label, checked: true, accent, dim })`,
    w: 18, h: 1, draw: (p) => checkbox(p, { x: 0, y: 0, label: 'hermetic', checked: true, accent: PAL.ok, dim: PAL.dim }),
  },
  {
    name: 'radio', group: 'inputs', desc: 'Radio button + label.',
    usage: `radio(p, { x, y, label, selected: true, accent, dim })`,
    w: 18, h: 1, draw: (p) => radio(p, { x: 0, y: 0, label: 'strict', selected: true, accent: PAL.acc, dim: PAL.dim }),
  },
  {
    name: 'toggle', group: 'inputs', desc: 'Switch — knob at the on/off end.',
    usage: `toggle(p, { x, y, on: true, accent, track, knob })`,
    w: 6, h: 2, draw: (p) => toggle(p, { x: 0, y: 1, on: true, accent: PAL.ok, track: PAL.line, knob: PAL.bg }),
  },
  {
    name: 'slider', group: 'inputs', desc: 'Track + accent fill to the knob.',
    usage: `slider(p, { rect, value: 0.6, accent, track })`,
    w: 22, h: 1, draw: (p) => slider(p, { rect: { x: 0, y: 0, w: 20 }, value: 0.6, accent: PAL.acc, track: PAL.line }),
  },
  {
    name: 'textField', group: 'inputs', desc: 'Labelled field; accent border when focused.',
    usage: `textField(p, { rect, label, value, focused: true, accent, dim, fg })`,
    w: 24, h: 4, draw: (p) => textField(p, { rect: { x: 0, y: 0, w: 22, h: 3 }, label: 'name', value: 'react-todo', focused: true, accent: PAL.acc, dim: PAL.dim, fg: PAL.fg }),
  },
  {
    name: 'select', group: 'inputs', desc: 'Dropdown — value + ▾ chevron.',
    usage: `select(p, { rect, value, open: true, accent, dim, fg })`,
    w: 24, h: 3, draw: (p) => select(p, { rect: { x: 0, y: 0, w: 22, h: 3 }, value: 'vitest', open: true, accent: PAL.acc, dim: PAL.dim, fg: PAL.fg }),
  },

  {
    name: 'alert', group: 'feedback', desc: 'Callout — accent rail + icon + title + message.',
    usage: `alert(p, { rect, icon, title, message, accent, fg, dim })`,
    w: 40, h: 4, draw: (p) => alert(p, { rect: { x: 0, y: 0, w: 40, h: 4 }, icon: '✓', title: 'accepted', message: '22 tests · 100% cov · 0 flake', accent: PAL.ok, fg: PAL.fg, dim: PAL.dim }),
  },
  {
    name: 'banner', group: 'feedback', desc: 'Full-width filled banner.',
    usage: `banner(p, { rect, text, accent, fg })`,
    w: 40, h: 3, draw: (p) => banner(p, { rect: { x: 0, y: 0, w: 40, h: 3 }, text: 'mutation gate: strict', accent: PAL.warn, fg: PAL.bg }),
  },
  {
    name: 'tooltip', group: 'feedback', desc: 'Bubble with a downward tail.',
    usage: `tooltip(p, { x, y, text, accent, fg })`,
    w: 20, h: 4, draw: (p) => tooltip(p, { x: 0, y: 0, text: 'surviving mutant', accent: PAL.acc, fg: PAL.bg }),
  },
  {
    name: 'dialog', group: 'feedback', desc: 'Modal — title, body, action pills.',
    usage: `dialog(p, { rect, title, body, actions, accent, fg, dim, panel })`,
    w: 44, h: 8, draw: (p) => dialog(p, { rect: { x: 0, y: 0, w: 44, h: 8 }, title: 'discard run?', body: 'the worktree changes will be lost.', actions: ['cancel', 'discard'], accent: PAL.err, fg: PAL.fg, dim: PAL.dim, panel: PAL.panel }),
  },

  {
    name: 'avatar', group: 'display', desc: 'Initials chip.',
    usage: `avatar(p, { x, y, initials, accent, fg })`,
    w: 5, h: 3, draw: (p) => avatar(p, { x: 0, y: 0, initials: 'MB', accent: PAL.mag, fg: PAL.bg }),
  },
  {
    name: 'chip', group: 'display', desc: 'Rounded tag; `filled` inverts.',
    usage: `chip(p, { x, y, text, accent, fg, filled })`,
    w: 14, h: 1, draw: (p) => chip(p, { x: 0, y: 0, text: 'e2e', accent: PAL.acc, fg: PAL.bg, filled: true }),
  },
  {
    name: 'card', group: 'display', desc: 'Surface — panel, title, divider, body.',
    usage: `card(p, { rect, title, lines, accent, fg, dim, panel })`,
    w: 34, h: 6, draw: (p) => card(p, { rect: { x: 0, y: 0, w: 34, h: 6 }, title: 'react-todo', lines: ['adapter: react-vitest', 'gates: 6 green'], accent: PAL.acc, fg: PAL.fg, dim: PAL.dim, panel: PAL.panel }),
  },
  {
    name: 'divider', group: 'display', desc: 'Rule with an optional centred label.',
    usage: `divider(p, { x, y, w, label, line, dim })`,
    w: 34, h: 1, draw: (p) => divider(p, { x: 0, y: 0, w: 32, label: 'harvest', line: PAL.line, dim: PAL.dim }),
  },
  {
    name: 'stat', group: 'display', desc: 'Metric — value, label, delta.',
    usage: `stat(p, { x, y, label, value, delta, accent, fg, dim })`,
    w: 18, h: 2, draw: (p) => stat(p, { x: 0, y: 0, label: 'coverage', value: '100%', delta: '▲4', accent: PAL.ok, fg: PAL.fg, dim: PAL.dim }),
  },
  {
    name: 'accordion', group: 'display', desc: '▾/▸ header rows; open rows reveal a body.',
    usage: `accordion(p, { rect, rows, accent, fg, dim })`,
    w: 30, h: 3, draw: (p) => accordion(p, { rect: { x: 0, y: 0, w: 30, h: 3 }, rows: [{ title: 'gates', open: true, body: 'validation · audit · hermetic' }, { title: 'harvest', open: false }], accent: PAL.acc, fg: PAL.fg, dim: PAL.dim }),
  },
  {
    name: 'tree', group: 'display', desc: 'Indented rows with ├─/└─ connectors.',
    usage: `tree(p, { x, y, rows, accent, fg, dim })`,
    w: 22, h: 4, draw: (p) => tree(p, { x: 0, y: 0, rows: [{ depth: 0, label: 'src', last: false }, { depth: 1, label: 'loop', last: false }, { depth: 1, label: 'runes', last: true }], accent: PAL.acc, fg: PAL.fg, dim: PAL.dim }),
  },
  {
    name: 'timeline', group: 'display', desc: '● nodes joined by │; done in accent.',
    usage: `timeline(p, { x, y, rows, accent, fg, dim })`,
    w: 22, h: 5, draw: (p) => timeline(p, { x: 0, y: 0, rows: [{ label: 'probe', done: true }, { label: 'generate', done: true }, { label: 'accept', done: false }], accent: PAL.ok, fg: PAL.fg, dim: PAL.dim }),
  },

  {
    name: 'breadcrumb', group: 'navigation', desc: 'Crumbs joined by ›; last in accent.',
    usage: `breadcrumb(p, { x, y, crumbs, accent, dim })`,
    w: 30, h: 1, draw: (p) => breadcrumb(p, { x: 0, y: 0, crumbs: ['runs', 'react-todo', 'gates'], accent: PAL.acc, dim: PAL.dim }),
  },
  {
    name: 'pagination', group: 'navigation', desc: '‹ 1 2 [3] 4 › — current boxed.',
    usage: `pagination(p, { x, y, pages, current, accent, dim })`,
    w: 24, h: 1, draw: (p) => pagination(p, { x: 0, y: 0, pages: 5, current: 3, accent: PAL.acc, dim: PAL.dim }),
  },
  {
    name: 'stepper', group: 'navigation', desc: '①②③ nodes joined by ─; reached in accent.',
    usage: `stepper(p, { x, y, steps, current, accent, dim, fg })`,
    w: 30, h: 2, draw: (p) => stepper(p, { x: 0, y: 0, steps: ['probe', 'gen', 'gate'], current: 1, accent: PAL.acc, dim: PAL.dim, fg: PAL.fg }),
  },
  {
    name: 'menu', group: 'navigation', desc: 'Rows with label + right-aligned shortcut.',
    usage: `menu(p, { rect, items, selected, accent, fg, dim, panel })`,
    w: 24, h: 5, draw: (p) => menu(p, { rect: { x: 0, y: 0, w: 24, h: 5 }, items: [{ label: 'run', shortcut: '⏎' }, { label: 'refactor', shortcut: 'r' }, { label: 'review', shortcut: 'v' }], selected: 0, accent: PAL.acc, fg: PAL.fg, dim: PAL.dim, panel: PAL.panel }),
  },

  {
    name: 'barChart', group: 'charts', desc: 'Categorical bars scaled to the series max.',
    usage: `barChart(p, { rect, values, accent, track })`,
    w: 26, h: 8, draw: (p) => barChart(p, { rect: { x: 0, y: 0, w: 26, h: 8 }, values: [3, 5, 2, 6, 4, 7, 5, 8], accent: PAL.acc, track: PAL.line }),
  },
  {
    name: 'donut', group: 'charts', desc: 'Proportion ring — one arc per segment.',
    usage: `donut(p, { cx, cy, r, segments, track, label })`,
    w: 16, h: 16, draw: (p) => donut(p, { cx: 8, cy: 8, r: 6, track: PAL.line, label: '78%', labelColor: PAL.ok, segments: [{ value: 78, color: PAL.ok }, { value: 14, color: PAL.warn }, { value: 8, color: PAL.err }] }),
  },
  {
    name: 'heatmap', group: 'charts', desc: 'Intensity-shaded cell grid (values 0..1).',
    usage: `heatmap(p, { x, y, cols, rows, values, base, color })`,
    w: 28, h: 5, draw: (p) => heatmap(p, { x: 0, y: 0, cols: 14, rows: 5, base: PAL.panel, color: PAL.ok, values: Array.from({ length: 70 }, (_, i) => ((i * 37) % 100) / 100) }),
  },
  {
    name: 'legend', group: 'charts', desc: 'Swatch + label rows — chart companion.',
    usage: `legend(p, { x, y, items, fg })`,
    w: 16, h: 3, draw: (p) => legend(p, { x: 0, y: 0, fg: PAL.fg, items: [{ label: 'accepted', color: PAL.ok }, { label: 'stalled', color: PAL.warn }, { label: 'error', color: PAL.err }] }),
  },
  {
    name: 'meter', group: 'charts', desc: 'Stacked segments sized to their share.',
    usage: `meter(p, { rect, segments, track })`,
    w: 26, h: 1, draw: (p) => meter(p, { rect: { x: 0, y: 0, w: 26, h: 1 }, track: PAL.line, segments: [{ value: 62, color: PAL.ok }, { value: 24, color: PAL.acc }, { value: 14, color: PAL.warn }] }),
  },
  {
    name: 'buttonGroup', group: 'controls', desc: 'Segmented control — active option fills.',
    usage: `buttonGroup(p, { x, y, options, active, accent, fg, dim })`,
    w: 22, h: 1, draw: (p) => buttonGroup(p, { x: 0, y: 0, options: ['day', 'week', 'month'], active: 1, accent: PAL.acc, fg: PAL.bg, dim: PAL.dim }),
  },
  {
    name: 'rating', group: 'controls', desc: '★ rating, hollow ☆ for the rest.',
    usage: `rating(p, { x, y, value, max, accent, dim })`,
    w: 6, h: 1, draw: (p) => rating(p, { x: 0, y: 0, value: 4, max: 5, accent: PAL.warn, dim: PAL.dim }),
  },
  {
    name: 'skeleton', group: 'feedback', desc: 'Loading placeholder — staggered bars.',
    usage: `skeleton(p, { rect, color, lines })`,
    w: 24, h: 4, draw: (p) => skeleton(p, { rect: { x: 0, y: 0, w: 24, h: 4 }, color: PAL.line, lines: 4 }),
  },
  {
    name: 'emptyState', group: 'feedback', desc: 'Centred nothing-here callout.',
    usage: `emptyState(p, { rect, icon, title, hint, accent, dim })`,
    w: 24, h: 5, draw: (p) => emptyState(p, { rect: { x: 0, y: 0, w: 24, h: 5 }, icon: '∅', title: 'no runs yet', hint: 'press l to launch', accent: PAL.acc, dim: PAL.dim }),
  },
  {
    name: 'scrollbar', group: 'display', desc: 'Track + thumb from total/visible/offset.',
    usage: `scrollbar(p, { x, y, h, total, visible, offset, color, track })`,
    w: 2, h: 8, draw: (p) => scrollbar(p, { x: 0, y: 0, h: 8, total: 30, visible: 8, offset: 8, color: PAL.acc, track: PAL.line }),
  },
];

// Render + pad the viewBox by half a cell each side so centred-baseline text on
// the edge rows isn't clipped by a tight (e.g. 1-tall) viewBox.
const svgOf = (e: Entry): string => {
  const p = new SvgPainter(e.w, e.h); e.draw(p);
  const h = Math.max(e.h, 1);
  return p.toSvg()
    .replace(/viewBox="[^"]*"/, `viewBox="-0.5 -0.7 ${e.w + 1} ${h + 1.4}"`)
    .replace(/width="[^"]*" height="[^"]*"/, `width="${e.w + 1}" height="${h + 1.4}"`);
};
const cellsOf = (e: Entry): string => { const p = new CellPainter(e.w, e.h); p.clear(PAL.bg); e.draw(p); return cellHtml(p.flush(), PAL.bg); };
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

const CSS = `
:root{color-scheme:dark}
body{margin:0;padding:24px;background:#04070f;color:#cfe3f5;font-family:system-ui,-apple-system,sans-serif}
h1{color:#4fd6ff;letter-spacing:.24em;text-transform:uppercase;font-size:15px}
.sub{color:#7d93ad;font-size:12px;margin-bottom:24px}
h2.group{color:#c792ea;letter-spacing:.2em;text-transform:uppercase;font-size:12px;margin:28px 0 8px;border-bottom:1px solid #1b2a44;padding-bottom:6px}
.card{border:1px solid #1b2a44;border-radius:14px;background:#0b1220;padding:16px 20px;margin:12px 0;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
.meta .name{color:#4fd6ff;font-weight:800;letter-spacing:.06em;font-size:15px}
.meta .desc{color:#cfe3f5;font-size:13px;margin:4px 0 10px}
.lab{color:#7d93ad;font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin:8px 0 4px}
pre.usage{background:#04070f;border:1px solid #1b2a44;border-radius:8px;padding:10px 12px;overflow:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace;color:#2fe6a8;margin:0}
.previews{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.svgwrap{max-width:100%}
svg{width:100%;height:auto;background:#04070f;border-radius:8px;padding:8px;box-sizing:border-box}
svg text{font-size:1.05px;dominant-baseline:central;font-family:ui-monospace,Menlo,monospace}
svg [stroke]{stroke-linecap:round}
svg rect[stroke]{stroke-width:.14px}
pre.cells{font:13px/1.05 ui-monospace,Menlo,monospace;border-radius:8px;padding:8px;overflow:auto;margin:0}
pre.cells span{display:inline-block;width:1ch}
`;

/** Full standalone HTML component catalog. */
export function renderGallery(): string {
  const groups = [...new Set(ENTRIES.map((e) => e.group))];
  const sections = groups.map((g) => {
    const cards = ENTRIES.filter((e) => e.group === g).map((e) => `
      <div class="card" data-widget="${e.name}">
        <div class="meta">
          <div class="name">${e.name}</div>
          <div class="desc">${esc(e.desc)}</div>
          <div class="lab">usage</div>
          <pre class="usage">${esc(e.usage)}</pre>
        </div>
        <div class="previews">
          <div><div class="lab">svg · dom</div><div class="svgwrap" style="width:${e.w * 11}px">${svgOf(e)}</div></div>
          <div><div class="lab">cells · terminal</div>${cellsOf(e)}</div>
        </div>
      </div>`).join('');
    return `<h2 class="group">${g}</h2>${cards}`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Facet component library</title><style>${CSS}</style></head>
<body><h1>Facet — component library</h1>
<div class="sub">Every component authored once against the Painter API; each shown in both backends (SVG + cells) with its usage. ${ENTRIES.length} components.</div>
${sections}
</body></html>`;
}

// Back-compat alias for the older test/name.
export const WIDGETS = ENTRIES;
