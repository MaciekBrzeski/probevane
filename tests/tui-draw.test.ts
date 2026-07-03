import { describe, it, expect } from 'vitest';
import { sparkline, pad, trunc, statusStyle, lamp, FG } from '../src/tui/draw.js';
import { pipelineReducer, replayDelayMs, type PipelineState } from '../src/observe/pipeline.js';

describe('sparkline', () => {
  it('maps values to block glyphs, tallest = full block', () => {
    const s = sparkline([1, 2, 4, 8], 8);
    expect([...s]).toHaveLength(4);
    expect(s.endsWith('█')).toBe(true); // max → full
    expect('▁▂'.includes(s[0])).toBe(true); // smallest value → low block
  });
  it('right-trims to width (newest kept)', () => {
    expect([...sparkline([1, 2, 3, 4, 5], 3)]).toHaveLength(3);
  });
  it('all-zero → flat low line; empty → empty', () => {
    expect(sparkline([0, 0, 0], 3)).toBe('▁▁▁');
    expect(sparkline([], 5)).toBe('');
  });
});

describe('pad / trunc', () => {
  it('right-pads to width', () => { expect(pad('ab', 5)).toBe('ab   '); });
  it('left-pads (right align)', () => { expect(pad('ab', 5, 'r')).toBe('   ab'); });
  it('truncates long strings with an ellipsis', () => {
    expect(pad('abcdef', 4)).toBe('abc…');
    expect(trunc('abcdef', 4)).toBe('abc…');
    expect(trunc('abc', 4)).toBe('abc');
  });
});

describe('statusStyle + lamp', () => {
  it('colors statuses by class', () => {
    expect(statusStyle('running').fg).toBe(FG.acc);
    expect(statusStyle('done').fg).toBe(FG.ok);
    expect(statusStyle('error').fg).toBe(FG.err);
    expect(statusStyle('cancelled').fg).toBe(FG.warn);
    expect(statusStyle('queued').fg).toBe(FG.dim);
  });
  it('lamp glyph + color per pipeline state', () => {
    expect(lamp('ok')).toEqual({ ch: '●', st: { fg: FG.ok, bold: true } });
    expect(lamp('err')).toEqual({ ch: '✖', st: { fg: FG.err, bold: true } });
    expect(lamp('active')).toEqual({ ch: '◉', st: { fg: FG.acc, bold: true } });
    expect(lamp('idle')).toEqual({ ch: '○', st: { fg: FG.dim } });
  });
});

describe('pipelineReducer (shared with the browser console)', () => {
  const runes = ['a', 'b', 'c'];
  const empty: PipelineState = {};
  it('a blocking gate flashes err', () => {
    expect(pipelineReducer(empty, { gate: 'b' }, runes)).toEqual({ b: 'err' });
  });
  it('a productive tool call cools every red gate to active', () => {
    const s = pipelineReducer({ b: 'err' }, { tool: 'write_file' }, runes);
    expect(s.b).toBe('active');
  });
  it('accept cascades all runes to ok', () => {
    const s = pipelineReducer({ b: 'active' }, { accepted: true }, runes);
    expect(s).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
  });
  it('terminal failure turns active lamps red', () => {
    const s = pipelineReducer({ b: 'active' }, { stopReason: 'error' }, runes);
    expect(s.b).toBe('err');
  });
  it('never mutates the input state', () => {
    const before: PipelineState = { b: 'err' };
    pipelineReducer(before, { tool: 't' }, runes);
    expect(before).toEqual({ b: 'err' });
  });
});

describe('replayDelayMs', () => {
  it('recorded gap /4, clamped to 250..1500', () => {
    expect(replayDelayMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.400Z')).toBe(250); // 400/4=100 → floor 250
    expect(replayDelayMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:04.000Z')).toBe(1000); // 4000/4
    expect(replayDelayMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:40.000Z')).toBe(1500); // clamp
  });
  it('missing timestamps → default 600', () => {
    expect(replayDelayMs(undefined, undefined)).toBe(600);
  });
});
