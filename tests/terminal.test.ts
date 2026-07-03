import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initTerminal, sessions, createSession, writeInput, killSession,
  reapIdle, reap, atCap, termEnabled, ringReplayB64, type TermSession,
} from '../src/server/terminal.js';

// Session core against the REAL python3 pty bridge (python3 is a host tool,
// present on CI ubuntu — the venv-bootstrap precedent relies on it too).
const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pty-bridge.py');

beforeEach(() => {
  initTerminal({ BRIDGE, PYTHON: 'python3', DEFAULT_CWD: '/tmp', MAX_SESSIONS: 2, RING_BYTES: 64, log: async () => {} });
  for (const id of [...sessions.keys()]) sessions.delete(id);
});
afterEach(() => { for (const s of sessions.values()) s.proc?.kill?.('SIGKILL'); sessions.clear(); });

const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('terminal sessions', () => {
  it('termEnabled reads PROBEVANE_TERMINAL per call', () => {
    const old = process.env.PROBEVANE_TERMINAL;
    delete process.env.PROBEVANE_TERMINAL;
    expect(termEnabled()).toBe(false);
    process.env.PROBEVANE_TERMINAL = '1';
    expect(termEnabled()).toBe(true);
    if (old === undefined) delete process.env.PROBEVANE_TERMINAL; else process.env.PROBEVANE_TERMINAL = old;
  });

  it('echoes input back through the PTY (cat, tty echo doubles it)', async () => {
    const s = createSession(['cat'], '/tmp');
    await settle(300);
    writeInput(s, b64('hello\n'));
    await settle();
    const out = Buffer.concat(s.ring).toString();
    expect(out).toContain('hello');
    killSession(s);
  });

  it('ring trims to RING_BYTES (keeps the tail)', async () => {
    const s = createSession(['cat'], '/tmp');
    await settle(300);
    for (let i = 0; i < 20; i++) writeInput(s, b64(`line${i}\n`));
    await settle(900);
    expect(s.ringBytes).toBeLessThanOrEqual(64 + 4096); // one over-cap chunk may remain
    expect(Buffer.concat(s.ring).toString()).toContain('line19');
    killSession(s);
  });

  it('atCap once MAX_SESSIONS live sessions exist', async () => {
    createSession(['cat'], '/tmp');
    expect(atCap()).toBe(false);
    createSession(['cat'], '/tmp');
    expect(atCap()).toBe(true);
    await settle(100);
  });

  it('propagates the child exit code', async () => {
    const s = createSession(['sh', '-c', 'exit 3'], '/tmp');
    await new Promise<void>((r) => s.proc.on('close', () => r()));
    expect(s.exitCode).toBe(3);
  });

  it('ringReplayB64 returns the scrollback as one base64 frame', async () => {
    const s = createSession(['cat'], '/tmp');
    await settle(300);
    writeInput(s, b64('abc\n'));
    await settle();
    const frame = ringReplayB64(s);
    expect(frame.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(frame.slice(6));
    expect(Buffer.from(payload.b, 'base64').toString()).toContain('abc');
    killSession(s);
  });
});

describe('reapIdle (pure over the map)', () => {
  const fake = (over: Partial<TermSession>): TermSession =>
    ({ id: 'x', cmd: [], proc: {} as never, ring: [], ringBytes: 0, subs: new Set(), lastSeen: 0, startedAt: '', ...over });

  it('reaps exited sessions and idle-with-no-subscribers, keeps busy ones', () => {
    const now = 1_000_000;
    sessions.set('exited', fake({ id: 'exited', exitCode: 0, lastSeen: now }));
    sessions.set('idle', fake({ id: 'idle', lastSeen: now - 10_000 }));
    sessions.set('watched', fake({ id: 'watched', lastSeen: 0, subs: new Set([{} as never]) }));
    sessions.set('fresh', fake({ id: 'fresh', lastSeen: now - 100 }));
    const reaped = reapIdle(now, 5000).sort();
    expect(reaped).toEqual(['exited', 'idle']);
  });

  it('reap() deletes the session from the map', () => {
    sessions.set('gone', fake({ id: 'gone', exitCode: 0 }));
    reap('gone');
    expect(sessions.has('gone')).toBe(false);
  });
});
