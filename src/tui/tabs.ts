// Tab model for the TUI — the terminal read of the browser console's tab bar.
// The tab SET/order/accent comes from the shared theme SSOT (TERMINAL_TABS);
// this module owns only the terminal x-geometry, shared by the painter
// (src/tui/views.ts tabBar) and mouse hit-testing (src/cli/tui-app.ts) so both
// agree on where each tab sits.

import { TERMINAL_TABS } from '../util/theme.js';

export const TABS: readonly string[] = TERMINAL_TABS.map((t) => t.id); // ['console','runs','cost']
/** A tab id from TERMINAL_TABS ('console', 'runs', …) — plain string so the theme SSOT can grow without edits here. */
export type Tab = string;

// Label width per tab: 2 marker cols + 2 spaces around the name. Active and
// inactive labels are the SAME width so the slots never shift on selection.
const slotWidth = (name: string): number => name.length + 4;

/** [start,end) column range of each tab label on row 0 (mirrors tabBar). */
export function tabSlots(tabs: readonly string[]): { start: number; end: number }[] {
  const slots: { start: number; end: number }[] = [];
  let x = 1;
  for (const name of tabs) {
    const w = slotWidth(name);
    slots.push({ start: x, end: x + w });
    x += w + 1; // one-col gap between tabs
  }
  return slots;
}

/** Rendered label for a tab (active gets » … « markers; both widths equal). */
export function tabLabel(name: string, active: boolean): string {
  return (active ? '» ' : '  ') + name.toUpperCase() + (active ? ' «' : '  ');
}

/** Tab index at screen column `x` on the tab row, or -1. */
export function tabAtX(tabs: readonly string[], x: number): number {
  return tabSlots(tabs).findIndex((s) => x >= s.start && x < s.end);
}
