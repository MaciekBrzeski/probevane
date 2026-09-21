// Runs subsystem + the shared right-hand drawer, extracted from main.tsx to keep
// that entry under the file-size gate. Signals-driven runs table, live watch,
// replay, and the drawer that project/run/live detail views all open into.
import { $, j, dirOf, type RunRecord } from './lib.ts';
import { signal, computed, effect, eachInto, when, flushSync } from '../signals.ts';
import { waveEnergy, waveWeather } from './components/chrome/WaveStrip.tsx';
import { consolePipelineEvent, consolePipelineReset, startTheater } from './console.tsx';

// --- drawer (shared detail panel; its DOM node is grabbed in initRuns) ---
let drawer: HTMLElement;
// Open the drawer with a fresh title/empty body so stale content never flashes.
export function openDrawer(title: string) { $('drawerTitle').textContent = title; $('drawerBody').textContent = ''; drawer.classList.add('open'); }
export function closeDrawer() { drawer.classList.remove('open'); }
let followES: EventSource | null = null;
// Close any live transcript follow so reopening a drawer can't leak EventSources.
function stopFollow() { if (followES) { followES.close(); followES = null; } }

// --- Runs (signals-driven; see docs/wiki/Signals.md) ---
interface ActiveJob { id: string; op: string; dir: string; status: string; startedAt?: string }
// 1Hz heartbeat for live elapsed timers — one signal, fine-grained text updates.
const tickSig = signal(Date.now());
setInterval(() => { tickSig.set(Date.now()); flushSync(); }, 1000);
function fmtElapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const s = Math.max(0, Math.floor((tickSig.get() - Date.parse(startedAt)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
const runFilter = signal('');
const runsTotal = signal(0);
const runRows = signal<RunRecord[]>([]);
const activeJobs = signal<ActiveJob[]>([]);
const visibleRuns = computed(() => {
  const f = runFilter.get();
  const rows = runRows.get();
  return f ? rows.filter((r) => (r.label || '').includes(f)) : rows;
});
// Identity-stable snapshots: re-use the previous object while a key's payload is
// byte-identical, so eachInto's identity checks see "unchanged".
function stabilize<T>(seen: Map<string, { json: string; item: T }>, key: (t: T) => string, list: T[]): T[] {
  return list.map((item) => {
    const k = key(item);
    const json = JSON.stringify(item);
    const prev = seen.get(k);
    if (prev && prev.json === json) return prev.item;
    seen.set(k, { json, item });
    return item;
  });
}
const runIdent = new Map<string, { json: string; item: RunRecord }>();
const jobIdent = new Map<string, { json: string; item: ActiveJob }>();
// Set the run-history filter (project name); the table re-derives itself.
export function filterRuns(name: string) { runFilter.set(name || ''); flushSync(); }

// Refresh the Runs tab state: active-jobs box + history table. Two separate try
// blocks on purpose — a dead /jobs must not hide the history.
export async function loadRuns() {
  try {
    const { jobs } = await j('/jobs');
    const active = (jobs as ActiveJob[]).filter((jb) => jb.status === 'running');
    activeJobs.set(stabilize(jobIdent, (jb) => String(jb.id), active));
    waveEnergy.set(Math.min(1, active.length / 2)); // the sea rises with activity
  } catch {}
  try {
    const { total, runs } = await j('/runs?limit=100');
    runsTotal.set(total);
    runRows.set(stabilize(runIdent, (r) => r.runId, runs));
  } catch {}
  flushSync();
}
// Drawer view for a finished run: replay button, headline stats, event timeline,
// then the captured transcript — each section fails soft.
async function openRun(r: RunRecord) {
  stopFollow();
  openDrawer('run — ' + (r.label || r.runId));
  const body = $('drawerBody');
  const dir = (r as { dir?: string }).dir ?? dirOf(r.label);
  body.appendChild(<button class="ghost" style="margin-bottom:8px" onClick={() => replayShow(r.runId)}>replay show ▶</button>);
  body.appendChild(<div class="muted">{`${r.runId} · ${r.model || ''} · ${r.accepted ? 'accepted' : r.stopReason} · $${r.cost ?? 0} · ${r.steps ?? '?'} steps`}</div>);
  try {
    const detail = await j('/run?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(r.runId));
    if (detail.events && detail.events.timeline && detail.events.timeline.length) {
      body.appendChild(
        <details>
          <summary>{`timeline · ${detail.events.steps} steps · ${detail.events.gateBlocks} gate blocks`}</summary>
          <pre>{detail.events.timeline.map((t: { step: number; tool?: string; gateBlocks: number; editedFiles?: string[] }) => `step ${t.step}  ${t.tool || ''}  blocks=${t.gateBlocks}${t.editedFiles ? '  edited ' + t.editedFiles.join(',') : ''}`).join('\n')}</pre>
        </details>,
      );
    }
  } catch {}
  body.appendChild(<h3>transcript</h3>);
  const tbox = (<div></div>) as HTMLElement;
  body.appendChild(tbox);
  try {
    const { turns } = await j('/transcript?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(r.runId));
    if (!turns.length) tbox.appendChild(<span class="muted">no transcript captured (PROBEVANE_TRANSCRIPT=0?)</span>);
    for (const t of turns) tbox.appendChild(<Turn t={t} />);
  } catch { tbox.appendChild(<span class="muted">transcript unavailable</span>); }
}
// Live watch: stream events into a pre + follow the transcript as turns append.
export async function openRunLive(dir: string) {
  stopFollow();
  openDrawer('live — ' + String(dir).split('/').pop());
  const body = $('drawerBody');
  const pre = (<pre></pre>) as HTMLElement;
  pre.textContent = ''; body.appendChild(<h3>events</h3>); body.appendChild(pre);
  body.appendChild(<h3>transcript (live)</h3>);
  const tbox = (<div></div>) as HTMLElement;
  body.appendChild(tbox);
  consolePipelineReset();
  const es = new EventSource('/stream?dir=' + encodeURIComponent(dir));
  es.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data);
      consolePipelineEvent(e); // every event also drives the console pipeline graph
      pre.textContent += (e.delta !== undefined ? e.delta : `[step ${e.step ?? '?'}] ${e.gate ? 'BLOCK ' + e.gate : e.tool ?? e.stopReason ?? ''}\n`);
      pre.scrollTop = pre.scrollHeight;
    } catch {}
  };
  drawer.addEventListener('transitionend', () => { if (!drawer.classList.contains('open')) es.close(); }, { once: true });
  const once = (ev: MessageEvent) => { try { const e = JSON.parse(ev.data); if (e.runId) { es.removeEventListener('message', once); followTranscript(dir, e.runId, tbox); } } catch {} };
  es.addEventListener('message', once);
}
// Tail a run's transcript over SSE, appending turns as the model produces them.
function followTranscript(dir: string, runId: string, tbox: HTMLElement) {
  stopFollow();
  followES = new EventSource('/transcript?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(runId) + '&follow=1');
  followES.onmessage = (ev) => { try { tbox.appendChild(<Turn t={JSON.parse(ev.data)} />); } catch {} };
}
// Programmatic tab switch — click the real button so the tabs handler does the work.
export function switchTab(go: string) { (document.querySelector(`nav.tabs button[data-go="${go}"]`) as HTMLElement).click(); }
// Theater: replay a captured run's recorded event stream in the console ($0).
async function replayShow(runId: string) {
  closeDrawer();
  switchTab('console');
  if (!(await startTheater(runId)))
    $('theaterTicker').textContent = 'no captured events for this run (older than the theater feature)';
}

// Wire the drawer + runs DOM AFTER mount() has created the nodes. Called once by main.
export function initRuns() {
  drawer = $('drawer');
  $('drawerClose').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  const ar = $('activeRuns');
  ar.textContent = ''; ar.className = '';
  const jobList = document.createElement('div');
  ar.append(jobList, when(() => activeJobs.get().length === 0, () => <span class="muted">no active runs</span>));
  eachInto(jobList, () => activeJobs.get(), (jb) => jb.id, (jb) => {
    // runtime h stringifies function children, so the live timer binds via an
    // explicit effect — created in the row's scope, it dies with the row.
    const elapsed = (<span class="muted" style="margin-left:6px"></span>) as HTMLElement;
    effect(() => { elapsed.textContent = fmtElapsed(jb.startedAt); });
    return (
      <div class="anim-enter">
        <span class="tag running">running</span>
        {' ' + jb.op + ' · ' + String(jb.dir).split('/').pop()}
        {elapsed}
        <button class="ghost" style="margin-left:8px" onClick={() => openRunLive(jb.dir)}>watch</button>
      </div>
    ) as HTMLElement;
  });

  const tbody = $('runs').querySelector('tbody')!;
  eachInto(tbody, () => visibleRuns(), (r) => r.runId, (r) => (<RunRow r={r} onOpen={openRun} />) as HTMLElement);
  $('runs').after(when(() => visibleRuns().length === 0, () => <div class="muted">none</div>));
  effect(() => {
    const f = runFilter.get();
    $('runsMeta').textContent = f ? `filtered by "${f}" (${visibleRuns().length}/${runsTotal.get()})` : `${runsTotal.get()} total`;
  });

  // Rain over the wave for a stretch when a NEW newest run arrives rejected —
  // failure you notice from across the room, then it passes.
  let lastNewest = '';
  let rainTimer = 0;
  effect(() => {
    const newest = runRows.get()[0];
    if (!newest || newest.runId === lastNewest) return;
    const first = lastNewest === '';
    lastNewest = newest.runId;
    if (!first && !newest.accepted) {
      waveWeather.set('rain');
      clearTimeout(rainTimer);
      rainTimer = window.setTimeout(() => { waveWeather.set('clear'); flushSync(); }, 12000);
    }
  });
}
