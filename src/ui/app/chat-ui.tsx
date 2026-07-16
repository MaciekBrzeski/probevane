import { $, type TurnData } from './lib.ts';

// Shared DOM/region helpers for the Chat tab — imported by both chat-tab.tsx
// (the run + interpret flow) and chat-history.tsx (recent dirs + past runs), so
// the region primitives live in one place and neither module owns the other.

/** A spinner + label, for a region computing/awaiting. */
export function spinner(label: string): Node {
  return <div class="chat-loading"><span class="chat-spinner"></span> {label}</div>;
}

/** A muted, softly-pulsing empty/unavailable state. */
export function empty(label: string): Node {
  return <div class="chat-empty">{label}</div>;
}

/** Append a node to the conversation (dropping the placeholder) and keep it scrolled. */
export function convoAppend(node: Node): void {
  const el = $('chat-convo');
  el.querySelector('.chat-empty')?.remove();
  el.appendChild(node);
  el.scrollTop = el.scrollHeight;
}

/** Append a role-tagged message to the conversation and keep it scrolled. */
export function convo(role: string, cls: string, body: Node): void {
  convoAppend(<div class={`chat-msg ${cls}`}><span class="chat-role">{role}</span> {body}</div>);
}

/** Append a full transcript turn (model text + tool calls/results) to the
 *  conversation — the durable, append-only history in the main window. */
export function convoTurn(t: TurnData): void {
  convoAppend(<Turn t={t} />);
}

/** A labelled divider in the conversation (marks a loaded past run's bounds). */
export function convoDivider(text: string): void {
  convoAppend(<div class="chat-divider">{text}</div>);
}

/** Replace the signals region wholesale (deterministic content is per-request). */
export function setSignals(node: Node): void {
  $('chat-signals').replaceChildren(node);
}

/** Replace the tool-output region. */
export function setTools(node: Node): void {
  $('chat-tools').replaceChildren(node);
}
