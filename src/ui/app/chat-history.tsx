import { $, j, type RunRecord, type TurnData } from './lib.ts';
import { convo, convoDivider, convoTurn, empty, setSignals, spinner } from './chat-ui.tsx';

// Chat-tab history: recent project dirs (a persisted datalist on the path input)
// and per-project past runs (loaded from the ledger + transcript-on-disk). All
// $0 — reads the /runs ledger and /transcript?dir&runId (no model call).

// --- recent project dirs (datalist history) ---------------------------------

const DIRS_KEY = 'pv-chat-dirs';

/** The current project-path input value, trimmed. */
export function dirVal(): string { return ($('chat-dir') as HTMLInputElement).value.trim(); }

/** Recently-used project dirs, most-recent first (persisted in localStorage). */
function recentDirs(): string[] {
  try { return JSON.parse(localStorage.getItem(DIRS_KEY) ?? '[]') as string[]; } catch { return []; }
}

/** Remember a dir at the front of the recent list (delete duplicates, cap 12). */
export function rememberDir(dir: string): void {
  if (!dir) return;
  const next = [dir, ...recentDirs().filter((d) => d !== dir)].slice(0, 12);
  try { localStorage.setItem(DIRS_KEY, JSON.stringify(next)); } catch { /* storage disabled */ }
}

/** Fill the path datalist from localStorage + the ledger's distinct dirs
 *  (skipping throwaway worktrees, whose transcripts are gone after cleanup). */
export async function fillDirs(): Promise<void> {
  let server: string[] = [];
  try {
    const { runs } = (await j('/runs?limit=300')) as { runs: RunRecord[] };
    server = runs.map((r) => r.dir).filter((d): d is string => !!d && !d.includes('probevane-wt'));
  } catch { /* daemon offline / no ledger */ }
  const all = [...new Set([...recentDirs(), ...server])];
  $('chat-dirs').replaceChildren(...all.map((d) => <option value={d}></option>));
}

// --- past runs (load a project's history) -----------------------------------

/** The op that produced a run, from its "op:path" ledger label. */
function opOf(label?: string): string { return (label ?? '').split(':')[0] || 'run'; }

/** Basename of a path (trailing slashes trimmed). */
function baseName(p: string): string { return p.replace(/\/+$/, '').split('/').pop() || p; }

/** The path portion of an "op:path" ledger label. */
function labelPath(label?: string): string { return (label ?? '').split(':').slice(1).join(':'); }

/** Locale date for a run's timestamp (raw ts if unparseable). */
function fmtDate(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as const;
  return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, opts);
}

/** Ledger runs belonging to this project dir (exact dir, or same basename). */
function runsForDir(runs: RunRecord[], dir: string): RunRecord[] {
  const base = baseName(dir);
  return runs.filter((r) => r.dir === dir || (!r.dir && baseName(labelPath(r.label)) === base));
}

/** The metadata line under a past-run card: steps · model · date. */
function runMeta(r: RunRecord): string {
  const parts = [r.steps != null ? `${r.steps} steps` : '', r.model ?? '', fmtDate(r.ts)];
  return parts.filter(Boolean).join(' · ');
}

/** One clickable past-run card — verdict + op + who/when; loads its transcript. */
function runHistoryCard(dir: string, r: RunRecord): Node {
  const ok = r.accepted;
  return (
    <div class="chat-hrun" onClick={() => void loadPastRun(dir, r)}>
      <span class="chat-op">{opOf(r.label)}</span>
      <span class={`chat-verdict ${ok ? 'ok' : 'err'}`}>{ok ? 'accepted' : (r.stopReason ?? 'stopped')}</span>
      <span class="muted chat-hmeta">{runMeta(r)}</span>
    </div>
  );
}

/** Load a past run's full transcript from disk into the main conversation. */
async function loadPastRun(dir: string, r: RunRecord): Promise<void> {
  convoDivider(`▾ past run · ${opOf(r.label)} · ${fmtDate(r.ts)} · ${r.runId}`);
  try {
    const q = `/transcript?dir=${encodeURIComponent(dir)}&runId=${encodeURIComponent(r.runId)}`;
    const { turns } = (await j(q)) as { turns: TurnData[] };
    if (!turns.length) {
      convo('assistant', 'asst', <span class="muted">no transcript on disk (workdir cleaned or older run)</span>);
      return;
    }
    for (const t of turns) convoTurn(t);
    convoDivider(`▴ end · ${r.accepted ? 'accepted' : (r.stopReason ?? 'stopped')}`);
  } catch { convo('assistant', 'asst err', <span>✗ could not load transcript</span>); }
}

// --- history view: search + incremental "load more" -------------------------

const PAGE = 30;

/** The current past-runs view state (one per Chat tab). */
interface HistoryView { dir: string; all: RunRecord[]; shown: number; query: string }
let view: HistoryView | null = null;

/** A run matches a query if every whitespace token is a substring of its
 *  searchable text (op · model · runId · stopReason · verdict). */
function matches(r: RunRecord, q: string): boolean {
  if (!q) return true;
  const hay = [opOf(r.label), r.model ?? '', r.runId, r.stopReason ?? '', r.accepted ? 'accepted' : 'failed'].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

/** Re-render the filtered, paginated card list + count (input kept for focus). */
function renderHistoryCards(): void {
  if (!view) return;
  const filtered = view.all.filter((r) => matches(r, view!.query));
  const kids: Node[] = filtered.slice(0, view.shown).map((r) => runHistoryCard(view!.dir, r));
  if (!filtered.length) {
    kids.push(empty(`no runs match “${view.query}”`));
  } else if (filtered.length > view.shown) {
    const hidden = filtered.length - view.shown;
    kids.push(
      <button class="act ghost chat-more" onClick={() => { view!.shown += PAGE; renderHistoryCards(); }}>
        load {Math.min(PAGE, hidden)} more · {hidden} hidden
      </button>,
    );
  }
  $('chat-hlist').replaceChildren(...kids);
  $('chat-hcount').textContent = view.query ? `${filtered.length} / ${view.all.length}` : `${view.all.length}`;
}

/** ⟲ HISTORY: load the project's past runs into the signals region, searchable
 *  and paginated (fetched once; filtered + sliced client-side). */
export async function showHistory(): Promise<void> {
  const dir = dirVal();
  if (!dir) { setSignals(empty('enter a project path first, then ⟲ HISTORY')); return; }
  rememberDir(dir);
  setSignals(spinner('loading past runs…'));
  let runs: RunRecord[] = [];
  try { runs = ((await j('/runs?limit=1000')) as { runs: RunRecord[] }).runs; } catch { /* offline */ }
  const all = runsForDir(runs, dir);
  if (!all.length) { setSignals(empty(`no past runs recorded for ${baseName(dir)}`)); return; }
  view = { dir, all, shown: PAGE, query: '' };
  const search = <input class="chat-hsearch" placeholder="search op / model / verdict / runId…" /> as HTMLInputElement;
  search.oninput = () => { view!.query = search.value.trim(); view!.shown = PAGE; renderHistoryCards(); };
  setSignals(
    <div>
      <div class="chat-signal-sub">past runs · {baseName(dir)} <span id="chat-hcount" class="muted"></span></div>
      {search}
      <div id="chat-hlist"></div>
    </div>,
  );
  renderHistoryCards();
}
