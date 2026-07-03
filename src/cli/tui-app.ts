import { spawn } from 'node:child_process';
import { blank, diff, type Screen } from '../tui/screen.js';
import { header, costPane, pipelinePane, jobsPane, alertsPane, footer, inputBar, runIndexAt, type Rect } from '../tui/views.js';
import { pipelineReducer, replayDelayMs, type PipelineState } from '../observe/pipeline.js';
import { LAUNCH_OPS } from '../observe/launch.js';

// The TUI driver — polls the daemon, paints the panes, diff-flushes, and routes
// keys. Terminal glue (cli/** is coverage-excluded); the pure render lives in
// src/tui/. One screen, four panes + header/footer, laid out from the tty size.

interface Data {
  health: Record<string, unknown>;
  totals: Record<string, unknown>;
  daily: { date: string; cost: number }[];
  jobs: { op: string; dir: string; status: string; startedAt: string }[];
  runs: { runId: string; label?: string; accepted?: boolean; stopReason?: string }[];
  runes: { name: string }[];
  alerts: { kind: string; severity: string; message: string }[];
}

const EMPTY: Data = { health: {}, totals: {}, daily: [], jobs: [], runs: [], runes: [], alerts: [] };

async function getJson(url: string): Promise<any> {
  return fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => null);
}

async function poll(base: string): Promise<Data> {
  const [health, agg, jobs, pipe, alerts, runs] = await Promise.all([
    getJson(`${base}/health`), getJson(`${base}/aggregate`), getJson(`${base}/jobs`),
    getJson(`${base}/pipeline`), getJson(`${base}/alerts`), getJson(`${base}/runs?limit=30`),
  ]);
  return {
    health: health ?? {},
    totals: agg?.totals ?? {},
    daily: agg?.daily ?? [],
    jobs: jobs?.jobs ?? [],
    runs: runs?.runs ?? [],
    runes: pipe?.runes ?? [],
    alerts: alerts?.alerts ?? [],
  };
}

interface Layout { cost: Rect; alerts: Rect; pipe: Rect; jobs: Rect }

/** 2×2 body grid under the header, shared by paint + mouse hit-testing. */
function layoutRects(w: number, h: number): Layout {
  const top = 2;
  const bodyH = h - top - 1;
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(bodyH / 2);
  return {
    cost: { x: 0, y: top, w: halfW, h: halfH },
    alerts: { x: halfW, y: top, w: w - halfW, h: halfH },
    pipe: { x: 0, y: top + halfH, w: halfW, h: bodyH - halfH },
    jobs: { x: halfW, y: top + halfH, w: w - halfW, h: bodyH - halfH },
  };
}

/** Compose the whole frame into a fresh Screen. */
function paint(w: number, h: number, d: Data, pipe: PipelineState, sel: number, input: string | null): Screen {
  const scr = blank(w, h);
  header(scr, d.health, d.totals);
  const L = layoutRects(w, h);
  costPane(scr, L.cost, d.daily);
  alertsPane(scr, L.alerts, d.alerts);
  pipelinePane(scr, L.pipe, d.runes, pipe);
  const runsForSel = d.runs.map((r, i) => ({ ...r, label: (i === sel ? '▸ ' : '  ') + (r.label ?? r.runId) }));
  jobsPane(scr, L.jobs, d.jobs, runsForSel);
  footer(scr, 'q quit · r refresh · l launch · s shell · ↑↓/click select · enter/click replay');
  if (input !== null) inputBar(scr, 'launch> ', input);
  return scr;
}

/** Replay a captured run's events through the pipeline lamps at recorded cadence. */
async function replay(base: string, runId: string, runes: string[], set: (p: PipelineState) => void): Promise<void> {
  const res = await getJson(`${base}/events?runId=${encodeURIComponent(runId)}`);
  const events: { ts?: string; tool?: string; gate?: string; accepted?: boolean; stopReason?: string }[] = res?.events ?? [];
  let state: PipelineState = {};
  for (let i = 0; i < events.length; i++) {
    state = pipelineReducer(state, events[i], runes);
    set(state);
    await new Promise((r) => setTimeout(r, replayDelayMs(events[i]?.ts, events[i + 1]?.ts)));
  }
}

/** Suspend the TUI (leave alt screen + raw), run `fn`, resume on completion. */
function suspended(fn: () => Promise<void>): Promise<void> {
  process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
  try { process.stdin.setRawMode?.(false); } catch { /* not a tty */ }
  return fn().finally(() => {
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');
    try { process.stdin.setRawMode?.(true); } catch { /* not a tty */ }
    process.stdin.resume();
  });
}

const runProc = (cmd: string, args: string[], opts: object): Promise<void> =>
  new Promise((done) => spawn(cmd, args, opts).on('close', () => done()));

const dropToShell = () => suspended(() => runProc(process.env.SHELL || 'bash', [], { stdio: 'inherit' }));

/**
 * Launch a typed command. A probevane op (generate/feature/…) goes to the
 * daemon (POST /run) so it appears in Jobs with a live light-show; anything
 * else is run through the shell (other harnesses: claude, aider, …),
 * suspending the TUI so the child owns the tty.
 */
async function launch(base: string, cmdLine: string): Promise<string> {
  const parts = cmdLine.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if ((LAUNCH_OPS as readonly string[]).includes(parts[0])) {
    const body = JSON.stringify({ op: parts[0], dir: parts[1] ?? '.', flags: parts.slice(2) });
    const r = await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    return r.error ? `✗ ${r.error}` : `▶ launched ${parts[0]} (job ${r.id})`;
  }
  await suspended(() => runProc(process.env.SHELL || 'bash', ['-ic', cmdLine], { stdio: 'inherit' }));
  return `ran: ${cmdLine}`;
}

/** Parse an SGR mouse frame `\x1b[<b;x;yM|m` → {b,x,y} (0-indexed x,y), or null. */
function parseMouse(k: string): { b: number; x: number; y: number; press: boolean } | null {
  const m = k.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
  if (!m) return null;
  return { b: Number(m[1]), x: Number(m[2]) - 1, y: Number(m[3]) - 1, press: m[4] === 'M' };
}

// The interactive app — state + one method per concern so each stays under the
// quality ceiling (nested closures would count against a single runTui body).
class TuiApp {
  data = EMPTY;
  pipe: PipelineState = {};
  sel = 0;
  prev: Screen | null = null;
  running = true;
  input: string | null = null; // non-null = typing a launch command
  status = '';
  constructor(private base: string, private quit: () => void) {}

  dims() { return { w: process.stdout.columns || 80, h: process.stdout.rows || 24 }; }

  draw() {
    const { w, h } = this.dims();
    const scr = paint(w, h, this.data, this.pipe, this.sel, this.input);
    if (this.status && this.input === null) footer(scr, this.status);
    process.stdout.write(diff(this.prev, scr));
    this.prev = scr;
  }
  async refresh() { this.data = await poll(this.base); this.draw(); }

  async doReplay() {
    const run = this.data.runs[this.sel];
    if (run) await replay(this.base, run.runId, this.data.runes.map((r) => r.name), (p) => { this.pipe = p; this.draw(); });
  }

  async onKey(k: string) {
    if (k === 'q' || k === '\x03') { this.running = false; return this.quit(); }
    if (k === 'r') return void this.refresh();
    if (k === 'l') { this.input = ''; return this.draw(); }
    if (k === '\x1b[A') { this.sel = Math.max(0, this.sel - 1); return this.draw(); }
    if (k === '\x1b[B') { this.sel = Math.min(this.data.runs.length - 1, this.sel + 1); return this.draw(); }
    if (k === 's') { await dropToShell(); this.prev = null; return this.refresh(); }
    if (k === '\r' || k === '\n') return this.doReplay();
  }

  async onInputKey(k: string) {
    if (k === '\x1b') { this.input = null; return this.draw(); } // Esc cancels
    if (k === '\r' || k === '\n') {
      const cmd = this.input ?? ''; this.input = null;
      this.status = 'launching…'; this.draw();
      this.status = await launch(this.base, cmd); this.prev = null; return this.refresh();
    }
    if (k === '\x7f' || k === '\b') { this.input = (this.input ?? '').slice(0, -1); return this.draw(); }
    if (k >= ' ') { this.input = (this.input ?? '') + k; return this.draw(); }
  }

  onMouse(mo: { b: number; x: number; y: number; press: boolean }) {
    if (mo.b === 64) { this.sel = Math.max(0, this.sel - 1); return this.draw(); } // wheel up
    if (mo.b === 65) { this.sel = Math.min(this.data.runs.length - 1, this.sel + 1); return this.draw(); } // wheel down
    if (!(mo.press && (mo.b & 3) === 0)) return; // only left-click
    const { jobs } = layoutRects(this.dims().w, this.dims().h);
    const active = this.data.jobs.filter((j) => j.status === 'running').length;
    const idx = runIndexAt(jobs, active, mo.y);
    if (idx < 0 || idx >= this.data.runs.length) return;
    if (idx === this.sel) void this.doReplay(); else { this.sel = idx; this.draw(); } // click selected = replay
  }

  onData = (buf: Buffer): void => {
    const k = buf.toString();
    const mo = parseMouse(k);
    if (mo) return this.onMouse(mo);
    void (this.input !== null ? this.onInputKey(k) : this.onKey(k));
  };

  async run() {
    process.stdout.on('resize', () => { this.prev = null; this.draw(); });
    process.stdin.on('data', this.onData);
    await this.refresh();
    while (this.running) {
      await new Promise((r) => setTimeout(r, 2000));
      if (this.running && this.input === null) await this.refresh();
    }
  }
}

export function runTui(base: string, quit: () => void): Promise<void> {
  return new TuiApp(base, quit).run();
}
