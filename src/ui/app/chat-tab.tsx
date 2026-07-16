import { $, j } from './lib.ts';
import type { Interpretation, Proposal } from '../../util/assistant-shape.ts';

// Chat tab renderer — the conversational assistant flow, in the control center's
// house style. Each request becomes a thread: the user turn, an interpreted PLAN
// CARD (op/kind/model/flags + $0 plan context, one Confirm gate), then the live
// run streamed inline, then the outcome + one-click PROPOSAL cards. The NL→plan
// and propose steps are $0 (server-side deterministic); only the run costs a model.

const MODELS = ['auto', 'haiku', 'sonnet', 'opus', 'bridge', 'ollama'];

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

/** Wire a proposal card's "run this" to re-enter the flow with its op + flags. */
function proposalCard(dir: string, p: Proposal): Node {
  return (
    <div class="chat-prop">
      <div><b>{p.title}</b> <span class="muted">({p.source})</span></div>
      <div class="muted">{p.why}</div>
      <button class="ghost" onClick={() => runLaunch(dir, p.op, p.flags, `${p.op} ${p.flags.join(' ')}`)}>run this ▶</button>
    </div>
  );
}

/** After a run ends: fetch $0 proposals and render them as next-step cards. */
async function showProposals(dir: string): Promise<void> {
  const { proposals } = (await j(`/assistant/propose?dir=${encodeURIComponent(dir)}`)) as { proposals: Proposal[] };
  if (!proposals.length) return;
  push(
    <div class="chat-turn asst">
      <span class="chat-role">assistant</span> proposed next steps:
      {proposals.map((p) => proposalCard(dir, p))}
    </div>,
  );
}

/** Launch a run (POST /run) and stream its events inline, then show proposals. */
async function runLaunch(dir: string, op: string, flags: string[], label: string): Promise<void> {
  const turn = push(<div class="chat-turn run"><span class="chat-role">run</span> {label}<pre class="chat-stream muted">launching…</pre></div>);
  const pre = turn.querySelector('.chat-stream') as HTMLElement;
  const body = JSON.stringify({ op, dir, flags });
  const r = (await j('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { id?: string; error?: string };
  if (r.error) { pre.textContent = '✗ ' + r.error; return; }
  pre.textContent = `▶ job ${r.id}\n`;
  streamRun(dir, pre, () => showProposals(dir));
}

/** Tail the loop's SSE events into `pre`; call onDone when the stream ends. */
function streamRun(dir: string, pre: HTMLElement, onDone: () => void): void {
  const es = new EventSource('/stream?dir=' + encodeURIComponent(dir));
  let last = '';
  es.onmessage = (ev: MessageEvent) => {
    try {
      const e = JSON.parse(ev.data) as { kind?: string; step?: number; tool?: string; stopReason?: string };
      const line = `${e.kind ?? 'event'}${e.step != null ? ` step ${e.step}` : ''}${e.tool ? ` · ${e.tool}` : ''}`;
      if (line !== last) { pre.textContent += line + '\n'; last = line; pre.classList.remove('muted'); }
      if (e.stopReason) { pre.textContent += `\n— ${e.stopReason} —\n`; es.close(); onDone(); }
    } catch { /* keepalive / partial frame */ }
  };
  es.onerror = () => { es.close(); };
}

/** The plan card: interpreted op + editable model, plus one Confirm gate. */
function planCard(r: Interpretation): Node {
  const dir = r.launch.dir;
  const modelSel = <select class="chat-model">{MODELS.map((m) => <option value={m}>{m}</option>)}</select> as HTMLSelectElement;
  const confirm = (
    <button class="act" onClick={() => {
      const flags = withModel(r.launch.flags, modelSel.value);
      runLaunch(dir, r.launch.op, flags, r.summary);
    }}>run ▶</button>
  );
  return (
    <div class="chat-turn asst">
      <span class="chat-role">assistant</span> {r.summary}
      {r.assumptions.length ? <ul class="chat-assume">{r.assumptions.map((a) => <li>{a}</li>)}</ul> : null}
      {r.planContext.length
        ? <div class="muted chat-ctx">context: {r.planContext.slice(0, 3).map((i) => `${i.action} ${i.target}`).join(' · ')}</div>
        : null}
      <div class="chat-run-row">model {modelSel} {confirm}</div>
    </div>
  );
}

/** Replace any existing --model flag with the card's selection (auto = default, drop it). */
function withModel(flags: string[], model: string): string[] {
  const out = flags.filter((f, i) => f !== '--model' && flags[i - 1] !== '--model');
  if (model !== 'auto') out.push('--model', model);
  return out;
}

/** Send the current request: interpret it ($0), then render the plan card. */
async function send(): Promise<void> {
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
