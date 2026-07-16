import { describe, it, expect } from 'vitest';
import { PALETTE, packed, cssVar, cssVars, TABS, TERMINAL_TABS, gauges, LAYOUTS, CONSOLE_PANES, RUN_COLUMNS, spanToBox, spanToCss } from '../src/util/theme.js';

describe('palette SSOT', () => {
  it('packs a hex into 0xRRGGBB for the terminal', () => {
    expect(packed('acc')).toBe(0x4fd6ff);
    expect(packed('err')).toBe(0xff5d6c);
    expect(packed('bg')).toBe(0x04070f);
  });
  it('cssVar / cssVars feed the browser :root', () => {
    expect(cssVar('acc')).toBe('var(--acc)');
    const v = cssVars();
    expect(v['--acc']).toBe('#4fd6ff');
    expect(v['--warn2']).toBe(PALETTE.warn); // legacy alias preserved
    expect(v['--frame']).toBe(PALETTE.acc);
  });
});

describe('tabs SSOT', () => {
  it('terminal renders every browser tab except the browser-only checks scoreboard', () => {
    const browser = ['projects', 'runs', 'docs', 'launch', 'cost', 'quality', 'checks', 'chat', 'console', 'terminal'];
    expect(TABS.map((t) => t.id)).toEqual(browser);
    expect(TERMINAL_TABS.map((t) => t.id)).toEqual(browser.filter((id) => id !== 'checks' && id !== 'chat'));
    expect(TERMINAL_TABS.every((t) => t.terminal)).toBe(true);
  });
});

describe('gauges SSOT', () => {
  it('derives the same accept + run-volume gauges both renderers draw', () => {
    const [accept, runs] = gauges({ acceptRate: 0.71, runs: 250 });
    expect(accept).toMatchObject({ id: 'accept', label: 'acceptance', raw: '71%', accent: 'ok' });
    expect(accept.value).toBeCloseTo(0.71);
    expect(runs).toMatchObject({ id: 'runs', raw: '250', accent: 'warn' });
    expect(runs.value).toBe(0.5); // 250 / 500
  });
  it('clamps out-of-range totals', () => {
    expect(gauges({ acceptRate: 2, runs: 9999 })[0].value).toBe(1);
    expect(gauges({}).map((g) => g.value)).toEqual([0, 0]);
  });
});

describe('run-column SSOT', () => {
  const col = (id: string) => RUN_COLUMNS.find((c) => c.id === id)!;
  it('derives each cell from a run record (both renderers use these accessors)', () => {
    const r = { ts: '2026-07-03T10:55:31Z', label: 'repair:x', model: 'replay', accepted: true, cost: 0, steps: 3 };
    expect(col('when').get(r)).toBe('2026-07-03 10:55:31');
    expect(col('label').get(r)).toBe('repair:x');
    expect(col('status').get(r)).toBe('accepted');
    expect(col('status').get({ stopReason: 'error' })).toBe('error');
    expect(col('cost').get(r)).toBe('$0');
    expect(col('steps').get(r)).toBe('3');
  });
  it('label falls back to runId', () => {
    expect(col('label').get({ runId: 'run-9' })).toBe('run-9');
  });
  it('marks the dim (muted) columns; status + label render in full colour', () => {
    expect(col('when').muted).toBe(true);
    expect(col('model').muted).toBe(true);
    expect(col('steps').muted).toBe(true);
    expect(col('cost').muted).toBe(true);
    expect(col('status').muted).toBeFalsy();
    expect(col('label').muted).toBeFalsy();
  });
});

describe('console layout SSOT', () => {
  it('is a pipeline hero over telemetry + constellation', () => {
    expect(CONSOLE_PANES.map((p) => p.id)).toEqual(['pipeline', 'telemetry', 'constellation']);
    expect(CONSOLE_PANES).toBe(LAYOUTS.console); // browser grid + terminal share the one manifest
  });
  it('LAYOUTS covers every terminal tab, spans within the unit square', () => {
    expect(new Set(Object.keys(LAYOUTS))).toEqual(new Set(TERMINAL_TABS.map((t) => t.id)));
    for (const panes of Object.values(LAYOUTS))
      for (const p of panes) expect(p.span.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it('spanToBox maps fractions into a concrete area (terminal rects)', () => {
    expect(spanToBox([0, 0, 1, 0.5], { x: 0, y: 1, w: 80, h: 20 })).toEqual({ x: 0, y: 1, w: 80, h: 10 });
    expect(spanToBox([0.5, 0.5, 1, 1], { x: 0, y: 0, w: 80, h: 20 })).toEqual({ x: 40, y: 10, w: 40, h: 10 });
  });
  it('spanToCss maps the same span to an absolute-inset rule (browser)', () => {
    expect(spanToCss([0, 0.5, 0.5, 1])).toBe('left:0.00%;top:50.00%;width:50.00%;height:50.00%');
  });
});
