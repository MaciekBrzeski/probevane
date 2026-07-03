import { $, j } from './lib.ts';

// Terminal tab client — xterm.js (CDN globals) over the daemon's /term/* SSE.
// Output: EventSource base64 frames → term.write. Input: onData → debounced
// POST /term/input. Resize: fit addon → POST /term/resize. One session at a
// time in the tab; reattaches to a live session after a reload.

declare const Terminal: new (opts: Record<string, unknown>) => {
  open(el: HTMLElement): void;
  write(data: Uint8Array | string): void;
  onData(cb: (s: string) => void): void;
  loadAddon(a: unknown): void;
  cols: number;
  rows: number;
  dispose(): void;
};
declare const FitAddon: { FitAddon: new () => { fit(): void; activate(t: unknown): void } };

let term: InstanceType<typeof Terminal> | null = null;
let fit: { fit(): void; activate(t: unknown): void } | null = null;
let es: EventSource | null = null;
let sessionId: string | null = null;
let inited = false;

function msg(text: string): void { $('termMsg').textContent = text; }

/** Idempotent lazy init — wire toolbar, reattach a live session if one exists. */
export async function loadTerminal(): Promise<void> {
  if (!inited) {
    inited = true;
    $('termBash').onclick = () => startSession([]);
    $('termClaude').onclick = () => startSession(['claude']);
    $('termKill').onclick = () => { if (sessionId) void j('/term/kill?id=' + sessionId, { method: 'POST' }); };
  }
  try {
    const list = await j('/term/sessions');
    const live = list.find((s: { live: boolean }) => s.live);
    if (live && !sessionId) openStream(live.id);
    else if (!sessionId) msg('pick a shell above');
  } catch {
    msg('terminal disabled — start the daemon with PROBEVANE_TERMINAL=1');
  }
}

async function startSession(cmd: string[]): Promise<void> {
  ensureTerm();
  fit?.fit();
  try {
    const body = JSON.stringify({ cmd: cmd.length ? cmd : undefined, cols: term!.cols, rows: term!.rows });
    const r = await j('/term/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (r.error) { msg('✗ ' + r.error); return; }
    openStream(r.id);
  } catch (e) { msg('✗ ' + String(e)); }
}

function ensureTerm(): void {
  if (term) return;
  term = new Terminal({ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, cursorBlink: true,
    theme: { background: '#02060d', foreground: '#cfe3f5', cursor: '#4fd6ff' } });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('termMount'));
  fit.fit();
  term.onData(sendInput);
  window.addEventListener('resize', debouncedFit);
}

// Batch keystrokes ~10ms so a fast typer isn't one POST per char.
let inQueue = '';
let inTimer: ReturnType<typeof setTimeout> | null = null;
function sendInput(s: string): void {
  inQueue += s;
  if (inTimer) return;
  inTimer = setTimeout(() => {
    const bytes = new TextEncoder().encode(inQueue);
    inQueue = ''; inTimer = null;
    if (sessionId) void fetch('/term/input?id=' + sessionId, { method: 'POST', body: btoa(String.fromCharCode(...bytes)) });
  }, 10);
}

function openStream(id: string): void {
  ensureTerm();
  if (es) es.close();
  sessionId = id;
  msg('▶ session ' + id);
  es = new EventSource('/term/stream?id=' + id);
  es.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.b !== undefined) term!.write(Uint8Array.from(atob(m.b), (c) => c.charCodeAt(0)));
      else if (m.exit !== undefined) { msg(`session ${id} exited (${m.exit})`); es?.close(); es = null; sessionId = null; }
    } catch { /* heartbeat / non-JSON */ }
  };
  fitAndResize();
}

function fitAndResize(): void {
  if (!term || !fit) return;
  fit.fit();
  if (sessionId)
    void fetch('/term/resize?id=' + sessionId, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols: term.cols, rows: term.rows }),
    });
}

let fitTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFit(): void {
  if (fitTimer) clearTimeout(fitTimer);
  fitTimer = setTimeout(fitAndResize, 150);
}

/** Called by main.tsx when the terminal tab activates (fit to its now-visible box). */
export function terminalActivated(): void {
  if (term) setTimeout(fitAndResize, 0);
}
