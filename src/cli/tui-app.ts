import { spawn } from 'node:child_process';
import { blank, diff, type Screen } from '../tui/screen.js';
import { header, costPane, pipelinePane, jobsPane, alertsPane, footer, type Rect } from '../tui/views.js';
import { pipelineReducer, replayDelayMs, type PipelineState } from '../observe/pipeline.js';

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

/** Compose the whole frame into a fresh Screen. */
function paint(w: number, h: number, d: Data, pipe: PipelineState, sel: number): Screen {
  const scr = blank(w, h);
  header(scr, d.health, d.totals);
  const top = 2;
  const bodyH = h - top - 1;
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(bodyH / 2);
  const cost: Rect = { x: 0, y: top, w: halfW, h: halfH };
  const alerts: Rect = { x: halfW, y: top, w: w - halfW, h: halfH };
  const pipeR: Rect = { x: 0, y: top + halfH, w: halfW, h: bodyH - halfH };
  const jobsR: Rect = { x: halfW, y: top + halfH, w: w - halfW, h: bodyH - halfH };
  costPane(scr, cost, d.daily);
  alertsPane(scr, alerts, d.alerts);
  pipelinePane(scr, pipeR, d.runes, pipe);
  const runsForSel = d.runs.map((r, i) => ({ ...r, label: (i === sel ? '▸ ' : '  ') + (r.label ?? r.runId) }));
  jobsPane(scr, jobsR, d.jobs, runsForSel);
  footer(scr, 'q quit · r refresh · s shell · ↑↓ select · enter replay light-show');
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

/** Suspend the TUI, run $SHELL inheriting the real tty, resume on exit. */
function dropToShell(): Promise<void> {
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  try { process.stdin.setRawMode?.(false); } catch { /* not a tty */ }
  return new Promise((done) => {
    const sh = spawn(process.env.SHELL || 'bash', [], { stdio: 'inherit' });
    sh.on('close', () => {
      process.stdout.write('\x1b[?1049h\x1b[?25l');
      try { process.stdin.setRawMode?.(true); } catch { /* not a tty */ }
      process.stdin.resume();
      done();
    });
  });
}

export async function runTui(base: string, quit: () => void): Promise<void> {
  let data = EMPTY;
  let pipe: PipelineState = {};
  let sel = 0;
  let prev: Screen | null = null;
  let running = true;
  const dims = () => ({ w: process.stdout.columns || 80, h: process.stdout.rows || 24 });

  const draw = () => {
    const { w, h } = dims();
    const scr = paint(w, h, data, pipe, sel);
    process.stdout.write(diff(prev, scr));
    prev = scr;
  };
  const refresh = async () => { data = await poll(base); draw(); };

  process.stdout.on('resize', () => { prev = null; draw(); });
  process.stdin.on('data', async (buf: Buffer) => {
    const k = buf.toString();
    if (k === 'q' || k === '\x03') { running = false; quit(); return; }
    if (k === 'r') return void refresh();
    if (k === '\x1b[A') { sel = Math.max(0, sel - 1); return draw(); }
    if (k === '\x1b[B') { sel = Math.min(data.runs.length - 1, sel + 1); return draw(); }
    if (k === 's') { await dropToShell(); prev = null; await refresh(); return; }
    if (k === '\r' || k === '\n') {
      const run = data.runs[sel];
      if (run) await replay(base, run.runId, data.runes.map((r) => r.name), (p) => { pipe = p; draw(); });
    }
  });

  await refresh();
  while (running) {
    await new Promise((r) => setTimeout(r, 2000));
    if (running) await refresh();
  }
}
