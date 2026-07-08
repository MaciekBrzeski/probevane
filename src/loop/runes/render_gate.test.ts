import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderGate, type RenderGateOpts } from './render_gate.js';
import { profile } from '../profiles.js';
import type { RunCtx } from '../ctx.js';

// render_gate is the visual acceptance oracle. All external effects (screenshot,
// vision judge, shell) are injected so these are deterministic + offline.

const ctx = () => ({ workdir: mkdtempSync(join(tmpdir(), 'probevane-render-')) }) as unknown as RunCtx;

const okCapture = vi.fn(async (_url: string, out: string) => out);
const okShell = async () => ({ ok: true, stdout: '', stderr: '' });

function gate(over: Partial<RenderGateOpts>) {
  return renderGate({
    url: 'http://localhost:1234',
    goal: 'creatures have dense fur',
    capture: okCapture,
    runCmd: okShell,
    ...over,
  });
}

describe('render_gate', () => {
  it('ALLOWS when the vision judge PASSes', async () => {
    const d = await gate({ ask: async () => 'PASS: fur is clearly dense and animated' }).shouldStop!(ctx());
    expect(d.kind).toBe('allow');
  });

  it('BLOCKS with the critique when the vision judge FAILs', async () => {
    const d = await gate({ ask: async () => 'FAIL: fur is too sparse to read as fur' }).shouldStop!(ctx());
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.reason).toContain('visual check failed');
      expect(d.inject).toContain('too sparse'); // the critique is fed back to the model
    }
  });

  it('BLOCKS when the perf command exits non-zero', async () => {
    const d = await gate({
      ask: async () => 'PASS: looks fine',
      perfCmd: 'npm run bench',
      runCmd: async () => ({ ok: false, stdout: 'frame 48ms > 33ms budget', stderr: '' }),
    }).shouldStop!(ctx());
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('perf budget');
  });

  it('BLOCKS when the reload command fails (never reaches vision)', async () => {
    const ask = vi.fn(async () => 'PASS');
    const d = await gate({
      ask,
      reloadCmd: 'npm run build',
      runCmd: async () => ({ ok: false, stdout: 'tsc error', stderr: '' }),
    }).shouldStop!(ctx());
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('reload command failed');
    expect(ask).not.toHaveBeenCalled();
  });

  it('BLOCKS with a clear message when the screenshot capture throws', async () => {
    const d = await gate({
      capture: async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); },
      ask: async () => 'PASS',
    }).shouldStop!(ctx());
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('could not capture');
  });

  it('adversarial majority: 3 votes, 2 FAIL → block', async () => {
    const verdicts = ['PASS: ok', 'FAIL: clips through body', 'FAIL: z-fighting'];
    let i = 0;
    const d = await gate({ votes: 3, ask: async () => verdicts[i++]! }).shouldStop!(ctx());
    expect(d.kind).toBe('block');
  });

  it('adversarial majority: 3 votes, 2 PASS → allow', async () => {
    const verdicts = ['PASS: great', 'FAIL: minor', 'PASS: matches goal'];
    let i = 0;
    const d = await gate({ votes: 3, ask: async () => verdicts[i++]! }).shouldStop!(ctx());
    expect(d.kind).toBe('allow');
  });
});

describe('visual profile wiring', () => {
  it('composes behavior_lock (tests stay green) + render_gate (visual oracle), no test-count acceptance', () => {
    const names = profile('visual', { kind: 'unit', render: { url: 'x', goal: 'y' } }).map((r) => r.name);
    expect(names).toContain('behavior_lock');
    expect(names).toContain('render_gate');
    expect(names).not.toContain('acceptance_gate'); // acceptance is visual, not a test count
    expect(names).not.toContain('red_first'); // no TDD for a visual change
  });

  it('omits render_gate when no render config is supplied', () => {
    const names = profile('visual', { kind: 'unit' }).map((r) => r.name);
    expect(names).not.toContain('render_gate');
    expect(names).toContain('behavior_lock');
  });
});
