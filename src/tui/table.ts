// Terminal text-table layout — fit the shared RUN_COLUMNS into a pane width
// (shedding low-priority columns when narrow) and paint aligned cells. Pure;
// the browser renders the SAME columns as a real <table>.

import { putText, type Screen, type Style } from './screen.js';
import { pad } from './draw.js';
import { RUN_COLUMN_DROP, type RunColumn } from '../ui/theme.js';

export interface ColBox { col: RunColumn; w: number }
const GAP = 1;
const MIN_GROW = 8;

const fixedWidth = (cols: RunColumn[]): number => cols.filter((c) => !c.grow).reduce((s, c) => s + c.w, 0);
const needed = (cols: RunColumn[]): number =>
  fixedWidth(cols) + (cols.some((c) => c.grow) ? MIN_GROW : 0) + GAP * Math.max(0, cols.length - 1);

/** Resolve column widths for `inner` cells — sheds RUN_COLUMN_DROP columns until it fits; grow col takes the slack. */
export function fitColumns(cols: RunColumn[], inner: number): ColBox[] {
  let active = [...cols];
  for (const id of RUN_COLUMN_DROP) {
    if (needed(active) <= inner) break;
    active = active.filter((c) => c.id !== id);
  }
  const growW = Math.max(MIN_GROW, inner - fixedWidth(active) - GAP * Math.max(0, active.length - 1));
  return active.map((c) => ({ col: c, w: c.grow ? growW : c.w }));
}

export interface TableCell { text: string; st: Style }
/** Paint one row of cells (text + style per column) at (x,y), each padded/aligned to its column width. */
export function renderColumns(scr: Screen, x: number, y: number, layout: ColBox[], cells: TableCell[]): void {
  let cx = x;
  layout.forEach((L, i) => {
    const cell = cells[i] ?? { text: '', st: {} };
    putText(scr, cx, y, pad(cell.text, L.w, L.col.align === 'r' ? 'r' : 'l'), cell.st);
    cx += L.w + GAP;
  });
}
