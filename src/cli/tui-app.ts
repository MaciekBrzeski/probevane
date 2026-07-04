import { spawn } from 'node:child_process';
import { blank, diff, fillRect, type Screen } from '../tui/screen.js';
import { tabBar, statusStrip, footer, inputBar, runIndexAt, type Snapshot } from '../tui/views.js';
import {
  paintConsole, paintRuns, paintCost, paintProjects, paintDocs, paintLaunch, paintQuality, paintTerminal,
  layoutFor, type Ui,
} from '../tui/screens.js';
import { TABS, tabAtX, type Tab } from '../tui/tabs.js';
import { pad, FG } from '../tui/draw.js';
import { pipelineReducer, replayDelayMs, type PipelineState } from '../observe/pipeline.js';
import { constellation } from '../observe/constellation.js';
import { LAUNCH_OPS } from '../observe/launch.js';

// The TUI driver — polls the daemon, paints the active tab, diff-flushes, and
// routes keys/mouse. Terminal glue (cli/** is coverage-excluded); the pure
// render + per-tab composition live in src/tui/. A fast animation tick advances
// the frame clock; the diff-flush means only actually-changed cells emit ANSI.

const EMPTY: Snapshot = {
  health: {}, totals: {}, daily: [], jobs: [], runs: [], runes: [], alerts: [], hubs: [],
  projects: [], wikiPages: [], ops: [],
};
const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);

async function getJson(url: string): Promise<any> {
  return fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => null);
}
async function getText(url: string): Promise<string> {
  return fetch(url, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
}

async function poll(base: string): Promise<Snapshot> {
  const [health, agg, jobs, pipe, alerts, runs, graph, projects, wiki, ops] = await Promise.all([
    getJson(`${base}/health`), getJson(`${base}/aggregate`), getJson(`${base}/jobs`),
    getJson(`${base}/pipeline`), getJson(`${base}/alerts`), getJson(`${base}/runs?limit=30`),
    getJson(`${base}/graph`), getJson(`${base}/projects`), getJson(`${base}/wiki`), getJson(`${base}/ops`),
  ]);
  return {
    health: health ?? {}, totals: agg?.totals ?? {}, daily: agg?.daily ?? [],
    jobs: jobs?.jobs ?? [], runs: runs?.runs ?? [], runes: pipe?.runes ?? [], alerts: alerts?.alerts ?? [],
    hubs: graph?.nodes ? constellation(graph.nodes) : [],
    projects: projects?.projects ?? [], wikiPages: wiki?.core ?? [], ops: ops?.ops ?? [],
  };
}

/** Format a /quality scan into terminal scorecard lines. */
function qualityLines(q: any): string[] {
  const files: any[] = q?.files ?? [];
  if (!files.length) return ['no source files'];
  const overCeil = (fn: any) => fn.params > 5 || fn.complexity > 12 || fn.loc > 50 || fn.cognitive > 15;
  const over = (f: any): number => (f.longLines ?? 0) + (f.debt ?? 0) + (f.functions ?? []).filter(overCeil).length;
  const lines = [`${pad('file', 30)} ${pad('loc', 6)} ${pad('fns', 5)} issues`];
  for (const f of files) {
    const fns = String((f.functions ?? []).length);
    lines.push(`${pad(f.file, 30)} ${pad(String(f.loc ?? 0), 6)} ${pad(fns, 5)} ${over(f) || '·'}`);
  }
  return lines;
}

/** Replay a captured run's events through the pipeline lamps at recorded cadence. */
async function replay(base: string, runId: string, runes: string[], set: (p: PipelineState) => void): Promise<void> {
  const res = await getJson(`${base}/events?runId=${encodeURIComponent(runId)}`);
  type RunEvent = { ts?: string; tool?: string; gate?: string; accepted?: boolean; stopReason?: string };
  const events: RunEvent[] = res?.events ?? [];
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

const HINTS = 'q quit · ⇥ tab · 1-8 view · l launch · s shell · ↑↓ select · enter replay';

// The interactive app — state + one method per concern so each stays under the
// quality ceiling (nested closures would count against a single runTui body).
class TuiApp {
  data = EMPTY;
  pipe: PipelineState = {};
  tab: Tab = 'console';
  sel = 0;
  prev: Screen | null = null;
  running = true;
  input: string | null = null; // non-null = typing a launch command
  status = '';
  ui: Ui = { docsSel: 0, docsBody: '', quality: '' }; // interactive per-tab state
  constFocus = 0; // ↑↓ cycles the highlighted constellation node on the Console tab
  private t0 = Date.now();
  private tabEnter = Date.now();
  private anim: ReturnType<typeof setInterval> | null = null;
  constructor(private base: string, private quit: () => void) {}

  dims() { return { w: process.stdout.columns || 80, h: process.stdout.rows || 24 }; }
  private now() { return Date.now() - this.t0; }
  private reveal() { return clamp01((Date.now() - this.tabEnter) / 400); } // gauge sweep-in on tab enter

  draw() {
    const { w, h } = this.dims();
    const scr = blank(w, h);
    fillRect(scr, 0, 0, w, h, FG.bg); // solid --bg field (kills terminal-wallpaper bleed-through)
    const t = this.now();
    tabBar(scr, TABS, TABS.indexOf(this.tab), t);
    statusStrip(scr, this.data.health, this.data.totals);
    const a = { t, reveal: this.reveal() };
    this.paintTab(scr, w, h, a);
    footer(scr, this.status && this.input === null ? this.status : HINTS);
    if (this.input !== null) inputBar(scr, 'launch> ', this.input);
    process.stdout.write(diff(this.prev, scr));
    this.prev = scr;
  }
  async refresh() { this.data = await poll(this.base); this.draw(); }

  /** Dispatch the active tab to its composer. */
  private paintTab(scr: Screen, w: number, h: number, a: { t: number; reveal: number }) {
    const d = this.data;
    const painters: Record<string, () => void> = {
      console: () => paintConsole(scr, w, h, d, this.pipe, a, this.constFocus),
      runs: () => paintRuns(scr, w, h, d, this.sel),
      cost: () => paintCost(scr, w, h, d, a),
      projects: () => paintProjects(scr, w, h, d),
      docs: () => paintDocs(scr, w, h, d, this.ui),
      launch: () => paintLaunch(scr, w, h, d),
      quality: () => paintQuality(scr, w, h, this.ui),
      terminal: () => paintTerminal(scr, w, h),
    };
    painters[this.tab]?.();
  }

  setTab(i: number) {
    this.tab = TABS[((i % TABS.length) + TABS.length) % TABS.length];
    this.tabEnter = Date.now();
    this.draw();
    void this.onTabEnter(); // lazy per-tab fetches (docs page, quality scan)
  }

  /** Fetch the data a tab needs on first view (docs page body, quality scan). */
  private async onTabEnter() {
    if (this.tab === 'docs') return this.loadDocsPage();
    if (this.tab === 'quality' && !this.ui.quality) {
      const q = await getJson(`${this.base}/quality?dir=${encodeURIComponent(process.cwd())}`);
      this.ui.quality = qualityLines(q).join('\n'); this.draw();
    }
  }

  private async loadDocsPage() {
    const file = this.data.wikiPages[this.ui.docsSel];
    if (!file) return;
    this.ui.docsBody = await getText(`${this.base}/wiki/raw/${encodeURIComponent(file)}`);
    if (this.tab === 'docs') this.draw();
  }

  async doReplay() {
    const run = this.data.runs[this.sel];
    if (!run) return;
    this.setTab(TABS.indexOf('console')); // watch the light-show on the Console tab
    await replay(this.base, run.runId, this.data.runes.map((r) => r.name), (p) => { this.pipe = p; this.draw(); });
  }

  private stop() { this.running = false; if (this.anim) clearInterval(this.anim); this.quit(); }

  // Single-key actions (number keys + arrows handled separately in onKey).
  private keys: Record<string, () => void | Promise<void>> = {
    q: () => this.stop(), '\x03': () => this.stop(),
    r: () => void this.refresh(),
    l: () => { this.input = ''; this.draw(); },
    '\t': () => this.setTab(TABS.indexOf(this.tab) + 1),
    s: async () => { await dropToShell(); this.prev = null; await this.refresh(); },
    '\r': () => this.doReplay(), '\n': () => this.doReplay(),
  };

  onKey(k: string): void | Promise<void> {
    if (k >= '1' && k <= '8') return this.setTab(Number(k) - 1);
    if (k === '\x1b[A') return this.moveSel(-1);
    if (k === '\x1b[B') return this.moveSel(1);
    return this.keys[k]?.();
  }

  /** ↑↓ — run on Runs, wiki page on Docs, focused constellation node on Console. */
  private moveSel(delta: number) {
    if (this.tab === 'docs') {
      this.ui.docsSel = Math.max(0, Math.min(this.data.wikiPages.length - 1, this.ui.docsSel + delta));
      this.draw(); return void this.loadDocsPage();
    }
    if (this.tab === 'console') { this.constFocus += delta; return this.draw(); } // graph clamps/wraps
    this.sel = Math.max(0, Math.min(this.data.runs.length - 1, this.sel + delta));
    this.draw();
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
    if (mo.y === 0) { const ti = tabAtX(TABS, mo.x); if (ti >= 0) this.setTab(ti); return; } // tab bar
    if (this.tab !== 'runs') return; // run list only lives on the Runs tab
    const { jobs } = layoutFor('runs', this.dims().w, this.dims().h);
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
    this.anim = setInterval(() => { if (this.running) this.draw(); }, 80); // ambient pulse / gauge sweep
    await this.refresh();
    while (this.running) {
      await new Promise((r) => setTimeout(r, 2000));
      if (this.running && this.input === null) await this.refresh();
    }
    if (this.anim) clearInterval(this.anim);
  }
}

export function runTui(base: string, quit: () => void): Promise<void> {
  return new TuiApp(base, quit).run();
}
