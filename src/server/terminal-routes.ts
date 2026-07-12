import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from './daemon-control.js';
import {
  sessions, termEnabled, createSession, writeInput, resize, killSession,
  attach, detach, ringReplayB64, atCap, type TermSession,
} from './terminal.js';

// HTTP surface for the terminal sessions. Split from terminal.ts to keep both
// under the quality ceiling. daemon-routes delegates any /term/ URL here.

export interface TermRouteCtx {
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  MAX_BODY: number;
  DEFAULT_CWD: string;
}

let CTX: TermRouteCtx;
/** Wire daemon.ts's config in once at startup. */
export function initTermRoutes(ctx: TermRouteCtx): void {
  CTX = ctx;
}

/** Dispatch a /term/* request; false when the URL isn't ours (daemon-routes falls through). */
export async function handleTerm(
  url: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!url.startsWith('/term/')) return false;
  if (!termEnabled()) { CTX.sendJson(res, 403, { error: 'terminal disabled — set PROBEVANE_TERMINAL=1' }); return true; }

  if (url === '/term/start' && req.method === 'POST') return handleStart(req, res);
  if (url === '/term/sessions') { CTX.sendJson(res, 200, listSessions()); return true; }
  return handleSession(url, query, req, res);
}

/** Routes that operate on an existing ?id= session. */
async function handleSession(
  url: string, query: URLSearchParams, req: IncomingMessage, res: ServerResponse,
): Promise<boolean> {
  const s = sessions.get(query.get('id') ?? '');
  if (!s) { CTX.sendJson(res, 404, { error: 'no such session' }); return true; }
  if (url === '/term/stream') return handleStream(s, req, res);
  if (url === '/term/input' && req.method === 'POST') return handleInput(s, req, res);
  if (url === '/term/resize' && req.method === 'POST') return handleResize(s, req, res);
  if (url === '/term/kill' && req.method === 'POST') {
    killSession(s); CTX.sendJson(res, 200, { id: s.id, killed: true }); return true;
  }
  CTX.sendJson(res, 404, { error: `no route ${url}` });
  return true;
}

/** GET /term/sessions — JSON-safe summaries (no proc/ring handles). */
function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id, cmd: s.cmd, startedAt: s.startedAt, live: s.exitCode === undefined, exitCode: s.exitCode,
  }));
}

/** POST /term/start — validate body + cwd, then spawn a PTY session (409 at the session cap). */
async function handleStart(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  let body: { cmd?: string[]; cwd?: string; cols?: number; rows?: number };
  try {
    body = JSON.parse((await readBody(req, CTX.MAX_BODY)) || '{}');
  } catch {
    CTX.sendJson(res, 400, { error: 'invalid JSON body' });
    return true;
  }
  if (atCap()) { CTX.sendJson(res, 409, { error: 'session cap reached' }); return true; }
  const cmd = Array.isArray(body.cmd) && body.cmd.length ? body.cmd.map(String) : [process.env.SHELL || 'bash'];
  const cwd = resolve(body.cwd || CTX.DEFAULT_CWD);
  if (!(await stat(cwd).then((s) => s.isDirectory()).catch(() => false))) {
    CTX.sendJson(res, 400, { error: `cwd not a directory: ${cwd}` });
    return true;
  }
  const s = createSession(cmd, cwd, body.cols, body.rows);
  CTX.sendJson(res, 200, { id: s.id, cmd: s.cmd, startedAt: s.startedAt });
  return true;
}

/** GET /term/stream — SSE attach: replay scrollback first, then live frames + heartbeat. */
function handleStream(s: TermSession, req: IncomingMessage, res: ServerResponse): boolean {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  if (s.ring.length) res.write(ringReplayB64(s)); // replay scrollback
  if (s.exitCode !== undefined) { res.write(`data: ${JSON.stringify({ exit: s.exitCode })}\n\n`); res.end(); return true; }
  attach(s, res);
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000);
  req.on('close', () => { clearInterval(hb); detach(s, res); });
  return true;
}

/** POST /term/input — forward base64 keystrokes to a live session (409 once exited). */
async function handleInput(s: TermSession, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (s.exitCode !== undefined) { CTX.sendJson(res, 409, { error: 'session exited' }); return true; }
  const b64 = (await readBody(req, CTX.MAX_BODY)).trim();
  writeInput(s, b64);
  CTX.sendJson(res, 200, { ok: true });
  return true;
}

/** POST /term/resize — resize the PTY; bad numbers fall back to 80x24. */
async function handleResize(s: TermSession, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  let body: { cols?: number; rows?: number };
  try {
    body = JSON.parse((await readBody(req, CTX.MAX_BODY)) || '{}');
  } catch {
    CTX.sendJson(res, 400, { error: 'invalid JSON body' });
    return true;
  }
  resize(s, Number(body.cols) || 80, Number(body.rows) || 24);
  CTX.sendJson(res, 200, { ok: true });
  return true;
}
