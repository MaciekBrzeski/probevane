import { j, type TurnData } from './lib.ts';
import { pipelineReducer, type PipelineState } from '../../observe/pipeline.ts';
import { convo, convoTurn, empty, setSignals, setTools, spinner } from './chat-ui.tsx';
import { dirVal, fillDirs, rememberDir, showHistory } from './chat-history.tsx';
import type { Interpretation, Proposal } from '../../util/assistant-shape.ts';

// Chat tab renderer — three regions, deterministic and non-deterministic kept
// apart per the layout:
//   • conversation (#chat-convo): the durable, append-only history — your request,
//     the assistant's narration + run lifecycle, the full transcript (every turn:
//     model text + tool calls/results, followed live), and past runs reloaded
//     from disk. Never wiped, so runs accumulate as scrollable history.
//   • signals (#chat-signals): the DETERMINISTIC $0 output — the interpreted plan
//     (op/flags), the plan context, post-run proposals, or a project's past-run
//     list (⟲ history). Replaced per request. See chat-history.tsx.
//   • tool output (#chat-tools): the run's LIVE status — the rune-pipeline strip
//     (which phase/gate is running, lit by the same reducer the console uses) and
//     a status line (active step · tool, or blocked-at gate, + tokens). Ephemeral;
//     the durable record is the transcript in the conversation window.
// Region primitives live in chat-ui.tsx; recent dirs + past runs in chat-history.tsx.
//
// Bridge is NOT offered here (a daemon run has no servicer for it → hangs), and
// the run row ALWAYS sends an explicit --model so the repo config default (which
// may be bridge) can't leak into a fire-and-forget daemon run.
// auto/haiku/sonnet/opus route through Anthropic; the ollama:* IDs are stronger
// tool-capable models on the cloud endpoint (the bare `ollama` = kimi default is
// weaker at the loop's multi-turn tool-calling).
const MODELS = [
  'auto', 'haiku', 'sonnet', 'opus',
  'ollama', 'ollama:qwen3.5:397b', 'ollama:deepseek-v4-pro', 'ollama:glm-5.2', 'ollama:gpt-oss:120b',
];

// One run at a time per tab — clicking several RUN buttons otherwise clobbers.
let running = false;

/** Enable/disable every run control while a run is in flight. */
function setRunning(on: boolean): void {
  running = on;
  document.querySelectorAll('.chat-run-btn, #chat-send').forEach((b) => {
    (b as HTMLButtonElement).disabled = on;
  });
}

// --- run row (shared by plan + proposal cards) ------------------------------

/** A model-select + gated RUN, always passing an explicit --model. */
function runRow(dir: string, op: string, baseFlags: string[], label: string): Node {
  const modelSel = <select class="chat-model">{MODELS.map((m) => <option value={m}>{m}</option>)}</select> as HTMLSelectElement;
  return (
    <div class="chat-run-row">
      model {modelSel}
      <button class="act chat-run-btn" onClick={() => {
        if (running) return;
        void runLaunch(dir, op, withModel(baseFlags, modelSel.value), label);
      }}>run ▶</button>
    </div>
  );
}

/** Force an explicit --model so the repo config default (maybe bridge) never drives. */
function withModel(flags: string[], model: string): string[] {
  const out = flags.filter((f, i) => f !== '--model' && flags[i - 1] !== '--model');
  out.push('--model', model);
  return out;
}

// --- signals content --------------------------------------------------------

/** The interpreted plan, rendered into the signals region with its run row. */
function planSignal(r: Interpretation): Node {
  return (
    <div class="chat-signal">
      <div class="chat-signal-head">plan · <b>{r.op}</b> <span class="muted">({r.kind}, conf {Math.round(r.confidence * 100)}%)</span></div>
      {r.assumptions.length ? <ul class="chat-assume">{r.assumptions.map((a) => <li>{a}</li>)}</ul> : null}
      {r.planContext.length
        ? <div class="chat-ctx">
            <div class="chat-signal-sub">context</div>
            {r.planContext.slice(0, 4).map((i) => <div class="muted">· {i.action} {i.target}</div>)}
          </div>
        : null}
      {runRow(r.launch.dir, r.launch.op, r.launch.flags, r.summary)}
    </div>
  );
}

/** One proposal card in the signals region (gated run row, not one-click). */
function proposalSignal(dir: string, p: Proposal): Node {
  return (
    <div class="chat-signal chat-prop">
      <div class="chat-signal-head">{p.title} <span class="muted">({p.source})</span></div>
      <div class="muted">{p.why}</div>
      {runRow(dir, p.op, p.flags, `${p.op} ${p.flags.join(' ')}`)}
    </div>
  );
}

/** After a run: fetch $0 proposals ($0) and append them under the signals region. */
async function showProposals(dir: string): Promise<void> {
  const el = document.getElementById('chat-signals')!;
  el.appendChild(spinner('computing proposals…'));
  const { proposals } = (await j(`/assistant/propose?dir=${encodeURIComponent(dir)}`)) as { proposals: Proposal[] };
  el.querySelector('.chat-loading')?.remove();
  if (!proposals.length) { el.appendChild(empty('no further proposals')); return; }
  el.appendChild(<div class="chat-signal-sub">proposed next (pick a model + run)</div>);
  for (const p of proposals) el.appendChild(proposalSignal(dir, p));
}

// --- pipeline strip ---------------------------------------------------------

/** One rune as the strip renders it (from GET /pipeline). */
interface PipeRune { name: string; phase: string; summary: string }

/** The full loop-event shape the strip + status line read (superset of the
 *  reducer's slice). All optional — a given event carries only some. */
interface RunEvent {
  runId?: string; step?: number; tool?: string; gate?: string;
  gateBlockReasons?: string[]; tokensIn?: number; tokensOut?: number;
  accepted?: boolean; stopReason?: string; delta?: string;
}

/** Map a launch op to the loop profile whose pipeline the strip should show. */
function profileFor(op: string): string {
  switch (op) {
    case 'feature': return 'feature';
    case 'refactor': return 'refactor';
    case 'repair': case 'fix': return op;
    case 'document': return 'document';
    default: return 'write_tests';
  }
}

/** Fetch the ordered runes for a profile ($0); [] if the endpoint is down. */
async function pipelineRunes(op: string): Promise<PipeRune[]> {
  try {
    const p = (await j('/pipeline?profile=' + encodeURIComponent(profileFor(op)))) as { runes: PipeRune[] };
    return p.runes.map((r) => ({ name: r.name, phase: r.phase, summary: r.summary }));
  } catch { return []; }
}

/** Paint the rune lamps — same idle/active/ok/err states the console light-show uses. */
function renderPipeline(host: HTMLElement, runes: PipeRune[], state: PipelineState): void {
  if (!runes.length) { host.replaceChildren(empty('pipeline unavailable')); return; }
  host.replaceChildren(...runes.map((r) => {
    const s = state[r.name] ?? 'idle';
    return <span class={`chat-rune s-${s}`} title={`${r.phase}: ${r.summary}`}>{r.name}</span>;
  }));
}

/** A one-line key for the rune-lamp colors, so the strip is self-explanatory. */
function pipelineLegend(): Node {
  return (
    <span class="chat-legend">
      <span><i class="lg lg-ok"></i>done</span>
      <span><i class="lg lg-active"></i>running</span>
      <span><i class="lg lg-err"></i>blocked</span>
      <span><i class="lg lg-idle"></i>pending</span>
    </span>
  );
}

/** The status message for one event: which step/tool runs, or which gate blocked. */
function statusMsg(e: RunEvent): string {
  if (e.accepted) return 'accepted — all gates green';
  if (e.stopReason) return `— ${e.stopReason} —`;
  if (e.gate) {
    const why = e.gateBlockReasons?.[0];
    return `blocked at ${e.gate}${why ? ` · ${why}` : ''}`;
  }
  if (e.tool) return `step ${e.step ?? '?'} · ${e.tool}`;
  if (e.step != null) return `step ${e.step}`;
  return 'working…';
}

/** The live one-liner node: pulsing dot + status message + a token counter. */
function statusLine(e: RunEvent): Node {
  const spent = (e.tokensOut ?? 0) || (e.tokensIn ?? 0);
  const tok = spent ? <span class="chat-tok">↑{e.tokensOut ?? 0} ↓{e.tokensIn ?? 0}</span> : null;
  return <span><span class="chat-live-dot"></span>{statusMsg(e)} {tok}</span>;
}

// --- run + stream -----------------------------------------------------------

/** Launch a run; the tool region shows the live pipeline strip + status (which
 *  phase/gate is running), the full transcript streams into the main conversation
 *  as durable history, and proposals land in signals on completion. */
async function runLaunch(dir: string, op: string, flags: string[], label: string): Promise<void> {
  setRunning(true);
  rememberDir(dir);
  const model = flags[flags.indexOf('--model') + 1] ?? 'auto';
  convo('assistant', 'asst', <span>running <b>{op}</b> with model <b>{model}</b>…</span>);

  const pipe = <div class="chat-pipeline"></div> as HTMLElement;
  const status = <div class="chat-status">{statusLine({})}</div> as HTMLElement;
  setTools(
    <div>
      <div class="chat-signal-sub">pipeline · {profileFor(op)} {pipelineLegend()}</div>
      {pipe}
      {status}
    </div>,
  );

  const runes = await pipelineRunes(op);
  let state: PipelineState = {};
  renderPipeline(pipe, runes, state);

  const body = JSON.stringify({ op, dir, flags });
  const r = (await j('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { id?: string; error?: string };
  if (r.error) {
    status.replaceChildren(<span class="chat-err">✗ {r.error}</span>);
    convo('assistant', 'asst err', <span>✗ {r.error}</span>);
    setRunning(false);
    return;
  }

  streamRun(dir, {
    onEvent: (e) => {
      state = pipelineReducer(state, e, runes.map((x) => x.name));
      renderPipeline(pipe, runes, state);
      status.replaceChildren(statusLine(e));
    },
    onTurn: convoTurn,
    onDone: (stop) => {
      setRunning(false);
      status.classList.add('chat-live-off');
      convo('assistant', 'asst', <span>run finished — <b>{stop ?? 'done'}</b></span>);
      void showProposals(dir);
      void fillDirs(); // the ledger just gained this run's dir
    },
  });
}

/** Tail the run: SSE events drive the pipeline + status; the first event's runId
 *  starts a transcript follow feeding chain-of-thought turns. */
function streamRun(
  dir: string,
  cb: { onEvent: (e: RunEvent) => void; onTurn: (t: TurnData) => void; onDone: (stop?: string) => void },
): void {
  const es = new EventSource('/stream?dir=' + encodeURIComponent(dir));
  let followES: EventSource | null = null;
  let done = false;
  const finish = (stop?: string) => { if (done) return; done = true; es.close(); followES?.close(); cb.onDone(stop); };
  es.onmessage = (ev: MessageEvent) => {
    try {
      const e = JSON.parse(ev.data) as RunEvent;
      // runId only surfaces on events; grab the first one to follow the transcript.
      if (e.runId && !followES) followES = followTranscript(dir, e.runId, cb.onTurn);
      if (e.delta !== undefined) return; // streamed token chunk — the transcript carries the text
      cb.onEvent(e);
      if (e.stopReason) finish(e.stopReason);
    } catch { /* keepalive / partial frame */ }
  };
  es.onerror = () => finish(); // stream dropped → re-enable, don't wedge
}

/** Follow a run's transcript over SSE, handing each turn to onTurn as it appends. */
function followTranscript(dir: string, runId: string, onTurn: (t: TurnData) => void): EventSource {
  const es = new EventSource('/transcript?dir=' + encodeURIComponent(dir) + '&runId=' + encodeURIComponent(runId) + '&follow=1');
  es.onmessage = (ev: MessageEvent) => { try { onTurn(JSON.parse(ev.data)); } catch { /* partial frame */ } };
  return es;
}

// --- interpret --------------------------------------------------------------

/** Send the current request: narrate it, interpret it ($0), fill the signals. */
async function send(): Promise<void> {
  if (running) return;
  const dir = dirVal();
  const promptEl = document.getElementById('chat-prompt') as HTMLInputElement;
  const prompt = promptEl.value.trim();
  if (!dir || !prompt) return;
  rememberDir(dir);
  convo('you', 'user', <span>{prompt}</span>);
  promptEl.value = '';
  setSignals(spinner('interpreting…'));
  const r = (await j('/assistant/interpret', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir, prompt }),
  })) as Interpretation;
  if (!r.ok) {
    setSignals(empty(`✗ ${r.error ?? 'could not interpret'}`));
    convo('assistant', 'asst err', <span>✗ {r.error ?? 'could not interpret'}</span>);
    return;
  }
  convo('assistant', 'asst', <span>{r.summary}</span>);
  setSignals(planSignal(r));
}

/** Bind the inputs once when the Chat tab first opens (and fill the dir history). */
export function loadChat(): void {
  const btn = document.getElementById('chat-send') as HTMLButtonElement;
  if (btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.onclick = () => void send();
  (document.getElementById('chat-history') as HTMLButtonElement).onclick = () => void showHistory();
  (document.getElementById('chat-prompt') as HTMLInputElement).addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') void send();
  });
  void fillDirs();
}
