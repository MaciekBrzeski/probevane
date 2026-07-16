import { $, j } from './lib.ts';
import type { Interpretation, Proposal } from '../../util/assistant-shape.ts';

// Chat tab renderer — three regions, deterministic and non-deterministic kept
// apart per the layout:
//   • conversation (#chat-convo): your request + the assistant's narration + run
//     lifecycle. The "talking to the model" thread.
//   • signals (#chat-signals): the DETERMINISTIC $0 output — the interpreted plan
//     (op/flags), the plan context, and post-run proposals. Replaced per request.
//   • tool output (#chat-tools): the run's streamed loop events (the model's
//     actual work), with a live indicator.
// Each region animates its loading / empty / unavailable state.
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

// --- region helpers ---------------------------------------------------------

/** A spinner + label, for a region computing/awaiting. */
function spinner(label: string): Node {
  return <div class="chat-loading"><span class="chat-spinner"></span> {label}</div>;
}

/** A muted, softly-pulsing empty/unavailable state. */
function empty(label: string): Node {
  return <div class="chat-empty">{label}</div>;
}

/** Append a message to the conversation and keep it scrolled. */
function convo(role: string, cls: string, body: Node): void {
  const el = $('chat-convo');
  el.querySelector('.chat-empty')?.remove();
  el.appendChild(<div class={`chat-msg ${cls}`}><span class="chat-role">{role}</span> {body}</div>);
  el.scrollTop = el.scrollHeight;
}

/** Replace the signals region wholesale (deterministic content is per-request). */
function setSignals(node: Node): void {
  const el = $('chat-signals');
  el.replaceChildren(node);
}

/** Replace the tool-output region. */
function setTools(node: Node): void {
  $('chat-tools').replaceChildren(node);
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
  const el = $('chat-signals');
  el.appendChild(spinner('computing proposals…'));
  const { proposals } = (await j(`/assistant/propose?dir=${encodeURIComponent(dir)}`)) as { proposals: Proposal[] };
  el.querySelector('.chat-loading')?.remove();
  if (!proposals.length) { el.appendChild(empty('no further proposals')); return; }
  el.appendChild(<div class="chat-signal-sub">proposed next (pick a model + run)</div>);
  for (const p of proposals) el.appendChild(proposalSignal(dir, p));
}

// --- run + stream -----------------------------------------------------------

/** Launch a run, stream its tool events into the tool region, narrate lifecycle
 *  in the conversation, then show proposals in signals. */
async function runLaunch(dir: string, op: string, flags: string[], label: string): Promise<void> {
  setRunning(true);
  const model = flags[flags.indexOf('--model') + 1] ?? 'auto';
  convo('assistant', 'asst', <span>running <b>{op}</b> with model <b>{model}</b>…</span>);
  const pre = <pre class="chat-stream"></pre> as HTMLElement;
  setTools(<div><div class="chat-live"><span class="chat-live-dot"></span>{label}</div>{pre}</div>);
  const body = JSON.stringify({ op, dir, flags });
  const r = (await j('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { id?: string; error?: string };
  if (r.error) { pre.textContent = '✗ ' + r.error; convo('assistant', 'asst err', <span>✗ {r.error}</span>); setRunning(false); return; }
  pre.textContent = `▶ job ${r.id}\n`;
  streamRun(dir, pre, (stop) => {
    setRunning(false);
    convo('assistant', 'asst', <span>run finished — <b>{stop ?? 'done'}</b></span>);
    $('chat-tools').querySelector('.chat-live')?.classList.add('chat-live-off');
    void showProposals(dir);
  });
}

/** Tail SSE tool events into `pre`; onDone(stopReason) when the stream ends. */
function streamRun(dir: string, pre: HTMLElement, onDone: (stop?: string) => void): void {
  const es = new EventSource('/stream?dir=' + encodeURIComponent(dir));
  let last = '';
  let done = false;
  const finish = (stop?: string) => { if (done) return; done = true; es.close(); onDone(stop); };
  es.onmessage = (ev: MessageEvent) => {
    try {
      const e = JSON.parse(ev.data) as { kind?: string; step?: number; tool?: string; stopReason?: string };
      const line = `${e.kind ?? 'event'}${e.step != null ? ` step ${e.step}` : ''}${e.tool ? ` · ${e.tool}` : ''}`;
      if (line !== last) { pre.textContent += line + '\n'; last = line; pre.scrollTop = pre.scrollHeight; }
      if (e.stopReason) { pre.textContent += `\n— ${e.stopReason} —\n`; finish(e.stopReason); }
    } catch { /* keepalive / partial frame */ }
  };
  es.onerror = () => finish(); // stream dropped → re-enable, don't wedge
}

// --- interpret --------------------------------------------------------------

/** Send the current request: narrate it, interpret it ($0), fill the signals. */
async function send(): Promise<void> {
  if (running) return;
  const dir = ($('chat-dir') as HTMLInputElement).value.trim();
  const prompt = ($('chat-prompt') as HTMLInputElement).value.trim();
  if (!dir || !prompt) return;
  convo('you', 'user', <span>{prompt}</span>);
  ($('chat-prompt') as HTMLInputElement).value = '';
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

/** Bind the input once when the Chat tab first opens. */
export function loadChat(): void {
  const btn = $('chat-send') as HTMLButtonElement;
  if (btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.onclick = () => void send();
  ($('chat-prompt') as HTMLInputElement).addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') void send();
  });
}
