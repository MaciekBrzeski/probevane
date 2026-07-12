import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { sseFrame } from '../loop/observe.js';

// Control-center TERMINAL sessions — a browser xterm attached to a daemon PTY
// (scripts/pty-bridge.py). SSE carries output down (base64 frames survive raw
// ANSI); POST carries keystrokes/resize/kill up. This BYPASSES the launch
// allowlist by design — it is a shell — so it is gated behind PROBEVANE_TERMINAL=1
// (checked per request in terminal-routes). daemon.ts wires config via initTerminal.

export interface TermSession {
  id: string;
  cmd: string[];
  proc: ChildProcess;
  ring: Buffer[]; // scrollback for late/reconnecting subscribers
  ringBytes: number;
  subs: Set<ServerResponse>;
  lastSeen: number; // epoch ms — idle reaper input
  startedAt: string;
  exitCode?: number;
}

/** Terminal config + logger, filled by daemon.ts via initTerminal() — paths and caps for the PTY bridge. */
export interface TerminalCtx {
  BRIDGE: string; // scripts/pty-bridge.py
  PYTHON: string; // interpreter (default python3)
  DEFAULT_CWD: string;
  MAX_SESSIONS: number;
  RING_BYTES: number;
  log: (level: string, event: string, data?: Record<string, unknown>) => Promise<void>;
}

let CTX: TerminalCtx;
export const sessions = new Map<string, TermSession>();

/** Wire the daemon's config in once at startup (module state — one daemon process). */
export function initTerminal(ctx: TerminalCtx): void {
  CTX = ctx;
}

/** Opt-in gate — read per call so route tests can flip it mid-suite. */
export function termEnabled(): boolean {
  return process.env.PROBEVANE_TERMINAL === '1';
}

/** Push one SSE frame to every live subscriber of the session. */
function broadcast(s: TermSession, frame: string): void {
  for (const res of s.subs) res.write(frame);
}

/** Append output to the scrollback ring, evicting oldest chunks past RING_BYTES. */
function pushRing(s: TermSession, chunk: Buffer): void {
  s.ring.push(chunk);
  s.ringBytes += chunk.length;
  while (s.ringBytes > CTX.RING_BYTES && s.ring.length > 1) {
    s.ringBytes -= s.ring.shift()!.length;
  }
}

/** Spawn the PTY bridge for `cmd` in `cwd`; wire output → ring + live subscribers. */
export function createSession(cmd: string[], cwd: string, cols = 80, rows = 24): TermSession {
  const id = randomUUID().slice(0, 8);
  const args = [CTX.BRIDGE, '--cwd', cwd, '--cols', String(cols), '--rows', String(rows), '--', ...cmd];
  const proc = spawn(CTX.PYTHON, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const s: TermSession = {
    id, cmd, proc, ring: [], ringBytes: 0, subs: new Set(),
    lastSeen: Date.now(), startedAt: new Date().toISOString(),
  };
  proc.stdout.on('data', (buf: Buffer) => {
    pushRing(s, buf);
    broadcast(s, sseFrame(JSON.stringify({ b: buf.toString('base64') })));
  });
  proc.stderr.on('data', (buf: Buffer) => void CTX.log('debug', 'term_stderr', { id, msg: buf.toString().slice(-200) }));
  proc.on('close', (code) => {
    s.exitCode = code ?? 0;
    broadcast(s, sseFrame(JSON.stringify({ exit: s.exitCode })));
    for (const res of s.subs) res.end();
    s.subs.clear();
    void CTX.log('info', 'term_exit', { id, cmd: cmd.join(' '), exitCode: s.exitCode });
  });
  sessions.set(id, s);
  void CTX.log('info', 'term_start', { id, cmd: cmd.join(' '), cwd });
  return s;
}

/** One NDJSON control line to the bridge stdin (best-effort). */
function control(s: TermSession, msg: Record<string, unknown>): void {
  s.proc.stdin?.write(JSON.stringify(msg) + '\n');
}

/** Forward base64 keystrokes to the PTY (bumps lastSeen so the idle reaper spares it). */
export function writeInput(s: TermSession, b64: string): void {
  s.lastSeen = Date.now();
  control(s, { t: 'd', b: b64 });
}

/** Resize the PTY, clamped to sane bounds so bad input can't wedge the bridge. */
export function resize(s: TermSession, cols: number, rows: number): void {
  const clamp = (n: number) => Math.max(2, Math.min(500, Math.round(n) || 24));
  control(s, { t: 'r', c: clamp(cols), r: clamp(rows) });
}

/** Ask the bridge to exit cleanly; SIGTERM the child if it hasn't within 2s. */
export function killSession(s: TermSession): void {
  control(s, { t: 'k' });
  setTimeout(() => { if (s.exitCode === undefined) s.proc.kill('SIGTERM'); }, 2000);
}

/** Subscribe an SSE response to live output (counts as activity for the reaper). */
export function attach(s: TermSession, res: ServerResponse): void {
  s.subs.add(res);
  s.lastSeen = Date.now();
}
/** Drop a closed SSE response from the session's subscribers. */
export function detach(s: TermSession, res: ServerResponse): void {
  s.subs.delete(res);
}

/** Whole ring as one base64 SSE frame (replayed to a fresh subscriber). */
export function ringReplayB64(s: TermSession): string {
  const all = Buffer.concat(s.ring);
  return sseFrame(JSON.stringify({ b: all.toString('base64') }));
}

/** True once live (unexited) sessions hit MAX_SESSIONS — /term/start refuses past this. */
export function atCap(): boolean {
  let live = 0;
  for (const s of sessions.values()) if (s.exitCode === undefined) live++;
  return live >= CTX.MAX_SESSIONS;
}

/**
 * Pure over the map: return ids of sessions that EXITED, or are live but idle
 * (no subscribers + no input) past `idleMs`. daemon.ts wires the timer + reaps.
 */
export function reapIdle(now: number, idleMs: number): string[] {
  const out: string[] = [];
  for (const [id, s] of sessions) {
    const idle = s.subs.size === 0 && now - s.lastSeen > idleMs;
    if (s.exitCode !== undefined || idle) out.push(id);
  }
  return out;
}

/** Kill (if still live) and drop one session — the daemon timer's action per reapIdle id. */
export function reap(id: string): void {
  const s = sessions.get(id);
  if (s && s.exitCode === undefined) killSession(s);
  sessions.delete(id);
}
