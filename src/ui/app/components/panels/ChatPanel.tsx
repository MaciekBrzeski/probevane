// Chat tab shell — the conversational assistant. Static frame only; chat-tab.tsx's
// wireChat() binds the input and appends turns (user request → interpreted plan
// card → live run → outcome + proposal cards) to #chat-log.
export function ChatPanel(): Node {
  return (
    <section data-tab="chat">
      <div class="panel wide chat">
        <h2>assistant <span class="muted">— describe what you want; probevane plans it, runs it, proposes next</span></h2>
        <div id="chat-log" class="chat-log"></div>
        <div class="chat-input">
          <input type="text" id="chat-dir" placeholder="/path/to/project" class="chat-dir" />
          <input type="text" id="chat-prompt" placeholder="e.g. add unit tests for the parser, or refactor the giant App component" />
          <button class="act" id="chat-send">SEND ▶</button>
        </div>
      </div>
    </section>
  );
}
