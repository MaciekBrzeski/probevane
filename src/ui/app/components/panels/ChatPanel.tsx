// Chat tab shell — three regions, wired by chat-tab.tsx's loadChat():
//   conversation (the model dialogue: your request + the assistant's narration),
//   signals (deterministic $0 plan + proposals, to the side),
//   tool calls / run output (the streamed loop events).
// Each region has its own loading/empty animation so it reads as live even when
// a region is idle or a fetch is in flight.
export function ChatPanel(): Node {
  return (
    <section data-tab="chat">
      <div class="panel wide chat">
        <h2>assistant <span class="muted">— describe what you want; probevane plans it, runs it, proposes next</span></h2>
        <div class="chat-grid">
          <div class="chat-col">
            <div class="chat-region-label">conversation</div>
            <div id="chat-convo" class="chat-region chat-convo">
              <div class="chat-empty">say what you want built, tested, or refactored…</div>
            </div>
          </div>
          <div class="chat-col">
            <div class="chat-region-label">signals <span class="muted">· deterministic · $0</span></div>
            <div id="chat-signals" class="chat-region chat-signals">
              <div class="chat-empty">the plan + proposals appear here</div>
            </div>
          </div>
        </div>
        <div class="chat-region-label">tool calls · run output</div>
        <div id="chat-tools" class="chat-region chat-tools">
          <div class="chat-empty">idle — confirm a plan to watch the loop work</div>
        </div>
        <div class="chat-input">
          <input type="text" id="chat-dir" placeholder="/path/to/project" class="chat-dir" />
          <input type="text" id="chat-prompt" placeholder="e.g. add unit tests for the parser, or refactor the giant App component" />
          <button class="act" id="chat-send">SEND ▶</button>
        </div>
      </div>
    </section>
  );
}
