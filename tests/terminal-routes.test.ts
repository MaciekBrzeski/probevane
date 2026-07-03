import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { initTerminal, sessions } from '../src/server/terminal.js';
import { initTermRoutes, handleTerm } from '../src/server/terminal-routes.js';

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pty-bridge.py');
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

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
  req.destroy = () => req.emit('error', new Error('destroyed'));
  if (body !== undefined) setImmediate(() => { req.emit('data', body); req.emit('end'); });
  return req;
}
const sendJson = (res: ServerResponse, code: number, body: unknown) => {
  (res as unknown as { statusCode: number }).statusCode = code;
  res.end(JSON.stringify(body));
};
const call = async (url: string, method = 'GET', body?: string) => {
  const res = fakeRes();
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  const handled = await handleTerm(url.split('?')[0], q, fakeReq(url, method, body), res as never);
  return { res, handled };
};

beforeAll(() => initTermRoutes({ sendJson, MAX_BODY: 1_000_000, DEFAULT_CWD: '/tmp' }));
beforeEach(() => {
  initTerminal({ BRIDGE, PYTHON: 'python3', DEFAULT_CWD: '/tmp', MAX_SESSIONS: 4, RING_BYTES: 65536, log: async () => {} });
  process.env.PROBEVANE_TERMINAL = '1';
  for (const id of [...sessions.keys()]) sessions.delete(id);
});
afterEach(() => { for (const s of sessions.values()) s.proc?.kill?.('SIGKILL'); sessions.clear(); delete process.env.PROBEVANE_TERMINAL; });

describe('handleTerm routing + gate', () => {
  it('returns false for non-/term/ URLs (daemon-routes falls through)', async () => {
    expect((await call('/health')).handled).toBe(false);
  });

  it('403 on every /term/* when PROBEVANE_TERMINAL is unset', async () => {
    delete process.env.PROBEVANE_TERMINAL;
    const { res, handled } = await call('/term/sessions');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('404 for an unknown session id', async () => {
    const { res } = await call('/term/input?id=nope', 'POST', 'aGk=');
    expect(res.statusCode).toBe(404);
  });

  it('start → sessions → input → kill lifecycle', async () => {
    const start = await call('/term/start', 'POST', JSON.stringify({ cmd: ['cat'] }));
    const { id } = JSON.parse(start.res.body);
    expect(id).toMatch(/^[a-f0-9]{8}$/);
    await settle();

    const list = JSON.parse((await call('/term/sessions')).res.body);
    expect(list.find((x: { id: string }) => x.id === id)?.live).toBe(true);

    const input = await call(`/term/input?id=${id}`, 'POST', Buffer.from('hi\n').toString('base64'));
    expect(input.res.statusCode).toBe(200);
    await settle();
    expect(Buffer.concat(sessions.get(id)!.ring).toString()).toContain('hi');

    const killed = await call(`/term/kill?id=${id}`, 'POST');
    expect(JSON.parse(killed.res.body).killed).toBe(true);
  });

  it('/term/stream replays the ring, then a fresh EventSource header block', async () => {
    const { res: sres } = await call('/term/start', 'POST', JSON.stringify({ cmd: ['cat'] }));
    const id = JSON.parse(sres.body).id;
    await settle();
    await call(`/term/input?id=${id}`, 'POST', Buffer.from('boot\n').toString('base64'));
    await settle();
    const { res } = await call(`/term/stream?id=${id}`);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('retry: 1000');
    const frame = res.body.split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(frame.slice(6));
    expect(Buffer.from(payload.b, 'base64').toString()).toContain('boot');
    sessions.get(id)!.proc.kill('SIGKILL');
  });

  it('409 at the session cap', async () => {
    initTerminal({ BRIDGE, PYTHON: 'python3', DEFAULT_CWD: '/tmp', MAX_SESSIONS: 1, RING_BYTES: 65536, log: async () => {} });
    await call('/term/start', 'POST', JSON.stringify({ cmd: ['cat'] }));
    const over = await call('/term/start', 'POST', JSON.stringify({ cmd: ['cat'] }));
    expect(over.res.statusCode).toBe(409);
    await settle(100);
  });
});
