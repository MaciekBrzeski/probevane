import { $, j } from './lib.ts';
import type { Interpretation, Proposal } from '../../util/assistant-shape.ts';

// Chat tab renderer — the conversational assistant flow, in the control center's
// house style. Each request becomes a thread: the user turn, an interpreted PLAN
// CARD (op/kind/flags + $0 plan context), a run row (pick model, one RUN gate),
// the live run streamed inline, then the outcome + PROPOSAL cards that re-enter
// the same run row (NOT one-click launch). The NL→plan and propose steps are $0;
// only the run costs a model.
//
// Bridge is NOT offered here: a daemon-spawned run has no Claude Code servicer to
// answer bridge requests, so a bridge run would hang forever. The run row ALWAYS
// sends an explicit --model so the target's probevane.config default (which may be
// bridge) never leaks into a fire-and-forget daemon run.
const MODELS = ['auto', 'haiku', 'sonnet', 'opus', 'ollama'];

// One run at a time per tab: the daemon can run many jobs, but launching several
// against the same repo from one conversation just clobbers — so RUN buttons are
// disabled while a run streams (the bug that let clicking spam concurrent runs).
let running = false;

/** Enable/disable every run control while a run is in flight. */
function setRunning(on: boolean): void {
  running = on;
  document.querySelectorAll('.chat-run-btn, #chat-send').forEach((b) => {
    (b as HTMLButtonElement).disabled = on;
  });
}

/** Append a node to the chat log and scroll it into view. */
function push(node: Node): HTMLElement {
  const log = $('chat-log');
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  return node as HTMLElement;
}

/** The user's request turn. */
function userTurn(prompt: string): void {
  push(<div class="chat-turn user"><span class="chat-role">you</span> {prompt}</div>);
}

/** A model-select + RUN control, shared by plan cards and proposal cards. Always
 *  passes --model explicitly (overriding the repo config), and no-ops when a run
 *  is already active. */
function runRow(dir: string, op: string, baseFlags: string[], label: string): Node {
  const modelSel = <select class="chat-model">{MODELS.map((m) => <option value={m}>{m}</option>)}</select> as HTMLSelectElement;
  return (
    <div class="chat-run-row">
      model {modelSel}
      <button class="act chat-run-btn" onClick={() => {
        if (running) return;
        runLaunch(dir, op, withModel(baseFlags, modelSel.value), label);
      }}>run ▶</button>
    </div>
  );
}

/** Wire a proposal into a card whose RUN re-enters the same gated run row. */
function proposalCard(dir: string, p: Proposal): Node {
  return (
    <div class="chat-prop">
      <div><b>{p.title}</b> <span class="muted">({p.source})</span></div>
      <div class="muted">{p.why}</div>
      {runRow(dir, p.op, p.flags, `${p.op} ${p.flags.join(' ')}`)}
    </div>
  );
}

/** After a run ends: fetch $0 proposals and render them as next-step cards. */
async function showProposals(dir: string): Promise<void> {
  const { proposals } = (await j(`/assistant/propose?dir=${encodeURIComponent(dir)}`)) as { proposals: Proposal[] };
  if (!proposals.length) return;
  push(
    <div class="chat-turn asst">
      <span class="chat-role">assistant</span> proposed next steps (pick a model + run one):
      {proposals.map((p) => proposalCard(dir, p))}
    </div>,
  );
}

/** Launch a run (POST /run) and stream its events inline, then show proposals. */
async function runLaunch(dir: string, op: string, flags: string[], label: string): Promise<void> {
  setRunning(true);
  const turn = push(<div class="chat-turn run"><span class="chat-role">run</span> {label}<pre class="chat-stream muted">launching…</pre></div>);
  const pre = turn.querySelector('.chat-stream') as HTMLElement;
  const body = JSON.stringify({ op, dir, flags });
  const r = (await j('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { id?: string; error?: string };
  if (r.error) { pre.textContent = '✗ ' + r.error; setRunning(false); return; }
  pre.textContent = `▶ job ${r.id}\n`;
  streamRun(dir, pre, () => { setRunning(false); void showProposals(dir); });
}

/** Tail the loop's SSE events into `pre`; call onDone when the stream ends. */
function streamRun(dir: string, pre: HTMLElement, onDone: () => void): void {
  const es = new EventSource('/stream?dir=' + encodeURIComponent(dir));
  let last = '';
  let done = false;
  const finish = () => { if (done) return; done = true; es.close(); onDone(); };
  es.onmessage = (ev: MessageEvent) => {
    try {
      const e = JSON.parse(ev.data) as { kind?: string; step?: number; tool?: string; stopReason?: string };
      const line = `${e.kind ?? 'event'}${e.step != null ? ` step ${e.step}` : ''}${e.tool ? ` · ${e.tool}` : ''}`;
      if (line !== last) { pre.textContent += line + '\n'; last = line; pre.classList.remove('muted'); }
      if (e.stopReason) { pre.textContent += `\n— ${e.stopReason} —\n`; finish(); }
    } catch { /* keepalive / partial frame */ }
  };
  es.onerror = () => finish(); // stream dropped → re-enable controls, don't wedge
}

/** The plan card: interpreted op + the gated run row (pick model, one RUN). */
function planCard(r: Interpretation): Node {
  return (
    <div class="chat-turn asst">
      <span class="chat-role">assistant</span> {r.summary}
      {r.assumptions.length ? <ul class="chat-assume">{r.assumptions.map((a) => <li>{a}</li>)}</ul> : null}
      {r.planContext.length
        ? <div class="muted chat-ctx">context: {r.planContext.slice(0, 3).map((i) => `${i.action} ${i.target}`).join(' · ')}</div>
        : null}
      {runRow(r.launch.dir, r.launch.op, r.launch.flags, r.summary)}
    </div>
  );
}

/** Force an explicit --model (drop any inherited one), so the repo config default
 *  — which may be bridge — never drives a daemon run. 'auto' IS passed explicitly. */
function withModel(flags: string[], model: string): string[] {
  const out = flags.filter((f, i) => f !== '--model' && flags[i - 1] !== '--model');
  out.push('--model', model);
  return out;
}

/** Send the current request: interpret it ($0), then render the plan card. */
async function send(): Promise<void> {
  if (running) return;
  const dir = ($('chat-dir') as HTMLInputElement).value.trim();
  const prompt = ($('chat-prompt') as HTMLInputElement).value.trim();
  if (!dir || !prompt) return;
  userTurn(prompt);
  ($('chat-prompt') as HTMLInputElement).value = '';
  const r = (await j('/assistant/interpret', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir, prompt }),
  })) as Interpretation;
  if (!r.ok) { push(<div class="chat-turn asst err"><span class="chat-role">assistant</span> ✗ {r.error ?? 'could not interpret'}</div>); return; }
  push(planCard(r));
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
