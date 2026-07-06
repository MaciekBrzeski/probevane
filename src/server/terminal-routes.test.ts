import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Colocated unit tests for the /term/* HTTP router. Covers the guard + error
// branches the sibling tests/terminal-routes.test.ts leaves to integration:
// unarmed 403, unknown-id 404, invalid-JSON 400 (start + resize), cwd-not-dir
// 400, session-cap 409, input-on-exited 409, kill 200, stream replay/exit, and
// the unknown-subroute 404. child_process.spawn is mocked (vi.hoisted) so
// createSession never launches a real shell; existing-session branches use
// hand-built fake sessions inserted into the imported `sessions` Map.

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { initTerminal, sessions, type TermSession } from './terminal.js';
import { initTermRoutes, handleTerm } from './terminal-routes.js';

interface FakeRes { statusCode: number; body: string; headers: Record<string, string> }
function fakeRes(): ServerResponse & FakeRes {
  const chunks: string[] = [];
  const res: any = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.writeHead = (c: number, h?: Record<string, string>) => { res.statusCode = c; Object.assign(res.headers, h ?? {}); return res; };
  res.write = (c: unknown) => { chunks.push(String(c)); return true; };
  res.end = (c?: unknown) => { if (c !== undefined) chunks.push(String(c)); };
  Object.defineProperty(res, 'body', { get: () => chunks.join('') });
  return res;
}
function fakeReq(url: string, method: string, body?: string): IncomingMessage {
  const req: any = new EventEmitter();
  Object.assign(req, { url, method, headers: {} });
  req.destroy = () => req.emit('end');
  if (body !== undefined) setImmediate(() => { req.emit('data', body); req.emit('end'); });
  return req;
}
const sendJson = (res: ServerResponse, code: number, body: unknown) => {
  (res as unknown as { statusCode: number }).statusCode = code;
  res.end(JSON.stringify(body));
};
async function call(url: string, method = 'GET', body?: string) {
  const res = fakeRes();
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  const req = fakeReq(url, method, body);
  const handled = await handleTerm(url.split('?')[0], q, req, res as never);
  return { res, req, handled };
}

function fakeChild() {
  const c: any = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = { write: vi.fn(() => true) };
  c.kill = vi.fn();
  return c;
}

function makeSession(over: Partial<TermSession> = {}): TermSession {
  const s = {
    id: over.id ?? 'aaaa0000',
    cmd: over.cmd ?? ['bash'],
    proc: fakeChild(),
    ring: over.ring ?? [],
    ringBytes: 0,
    subs: new Set<ServerResponse>(),
    lastSeen: Date.now(),
    startedAt: new Date().toISOString(),
    exitCode: over.exitCode,
  } as unknown as TermSession;
  sessions.set(s.id, s);
  return s;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => fakeChild());
  initTermRoutes({ sendJson, MAX_BODY: 1_000_000, DEFAULT_CWD: '/tmp' });
  initTerminal({ BRIDGE: 'pty-bridge.py', PYTHON: 'python3', DEFAULT_CWD: '/tmp', MAX_SESSIONS: 4, RING_BYTES: 65536, log: async () => {} });
  process.env.PROBEVANE_TERMINAL = '1';
  sessions.clear();
});
afterEach(() => { sessions.clear(); delete process.env.PROBEVANE_TERMINAL; vi.useRealTimers(); });

describe('handleTerm dispatch + gate', () => {
  it('resolves false for non-/term/ URLs so daemon-routes can fall through', async () => {
    const { handled, res } = await call('/health');
    expect(handled).toBe(false);
    expect(res.statusCode).toBe(200); // untouched
  });

  it('returns 403 on every /term/* when PROBEVANE_TERMINAL is unset', async () => {
    delete process.env.PROBEVANE_TERMINAL;
    const { res, handled } = await call('/term/sessions');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain('PROBEVANE_TERMINAL');
  });

  it('returns 404 for an unknown ?id on a session route', async () => {
    const { res } = await call('/term/input?id=ghost', 'POST', 'aGk=');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('no such session');
  });

  it('returns 404 for an unknown /term/<sub> route on a valid session', async () => {
    const s = makeSession();
    const { res } = await call(`/term/bogus?id=${s.id}`);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toContain('no route');
  });
});

describe('handleStart (/term/start)', () => {
  it('returns 400 on an invalid JSON body', async () => {
    const { res } = await call('/term/start', 'POST', '{not json');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid JSON body');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns the PTY bridge and returns 200 with an 8-hex id on the happy path', async () => {
    const { res } = await call('/term/start', 'POST', JSON.stringify({ cmd: ['echo', 'hi'], cwd: '/tmp' }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.id).toMatch(/^[a-f0-9]{8}$/);
    expect(out.cmd).toEqual(['echo', 'hi']);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(sessions.has(out.id)).toBe(true);
  });

  it('defaults cmd to the shell when the body carries no cmd', async () => {
    const { res } = await call('/term/start', 'POST', JSON.stringify({ cwd: '/tmp' }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(Array.isArray(out.cmd)).toBe(true);
    expect(out.cmd.length).toBe(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when cwd is not a directory', async () => {
    const { res } = await call('/term/start', 'POST', JSON.stringify({ cwd: '/no/such/dir/xyzzy-123' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('cwd not a directory');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the live-session cap is reached', async () => {
    initTerminal({ BRIDGE: 'pty-bridge.py', PYTHON: 'python3', DEFAULT_CWD: '/tmp', MAX_SESSIONS: 1, RING_BYTES: 65536, log: async () => {} });
    makeSession({ id: 'live0001' }); // one live session fills the cap
    const { res } = await call('/term/start', 'POST', JSON.stringify({ cmd: ['bash'], cwd: '/tmp' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('session cap reached');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('listSessions (/term/sessions)', () => {
  it('returns 200 with live + exited sessions and their exit codes', async () => {
    makeSession({ id: 'liveaaaa' });
    makeSession({ id: 'deadbbbb', exitCode: 7 });
    const { res } = await call('/term/sessions');
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body) as Array<{ id: string; live: boolean; exitCode?: number }>;
    expect(list.find((x) => x.id === 'liveaaaa')?.live).toBe(true);
    const dead = list.find((x) => x.id === 'deadbbbb');
    expect(dead?.live).toBe(false);
    expect(dead?.exitCode).toBe(7);
  });
});

describe('handleInput (/term/input)', () => {
  it('returns 409 when the session has already exited', async () => {
    const s = makeSession({ exitCode: 0 });
    const { res } = await call(`/term/input?id=${s.id}`, 'POST', 'aGk=');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('session exited');
  });

  it('forwards keystrokes to the PTY stdin and returns 200 ok', async () => {
    const s = makeSession();
    const { res } = await call(`/term/input?id=${s.id}`, 'POST', 'aGk=');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect((s.proc as any).stdin.write).toHaveBeenCalled();
    expect((s.proc as any).stdin.write.mock.calls[0][0]).toContain('aGk=');
  });
});

describe('handleResize (/term/resize)', () => {
  it('returns 400 on an invalid JSON body', async () => {
    const s = makeSession();
    const { res } = await call(`/term/resize?id=${s.id}`, 'POST', '{bad');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid JSON body');
  });

  it('applies the resize control frame and returns 200 ok', async () => {
    const s = makeSession();
    const { res } = await call(`/term/resize?id=${s.id}`, 'POST', JSON.stringify({ cols: 120, rows: 40 }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    const frame = (s.proc as any).stdin.write.mock.calls[0][0];
    expect(JSON.parse(frame.trim())).toMatchObject({ t: 'r', c: 120, r: 40 });
  });
});

describe('handleSession kill (/term/kill)', () => {
  it('returns 200 killed and sends the kill control frame', async () => {
    vi.useFakeTimers();
    const s = makeSession();
    const { res } = await call(`/term/kill?id=${s.id}`, 'POST');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: s.id, killed: true });
    const frame = (s.proc as any).stdin.write.mock.calls[0][0];
    expect(JSON.parse(frame.trim())).toEqual({ t: 'k' });
  });
});

describe('handleStream (/term/stream)', () => {
  it('replays the ring then emits an exit frame and ends for an exited session', async () => {
    const s = makeSession({ exitCode: 0, ring: [Buffer.from('bye there')] });
    const { res } = await call(`/term/stream?id=${s.id}`);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('retry: 1000');
    expect(res.body).toContain('"exit":0');
    const frame = res.body.split('\n').find((l) => l.startsWith('data: ') && l.includes('"b"'))!;
    const payload = JSON.parse(frame.slice(6));
    expect(Buffer.from(payload.b, 'base64').toString()).toContain('bye there');
    expect(s.subs.size).toBe(0); // exited: never attached
  });

  it('attaches a live subscriber, replays scrollback, and detaches on req close', async () => {
    const s = makeSession({ ring: [Buffer.from('scrollback!')] });
    const { res, req } = await call(`/term/stream?id=${s.id}`);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const frame = res.body.split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(frame.slice(6));
    expect(Buffer.from(payload.b, 'base64').toString()).toContain('scrollback!');
    expect(s.subs.size).toBe(1); // live: attached
    (req as unknown as EventEmitter).emit('close');
    expect(s.subs.size).toBe(0); // detached on close (interval cleared)
  });
});
