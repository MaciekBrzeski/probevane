// Chat tab shell — three regions, wired by chat-tab.tsx's loadChat():
//   conversation & transcript (the durable history: your requests, the model's
//     turns + tool calls, and past runs loaded from disk),
//   signals (deterministic $0 plan + proposals, or a project's past-run list),
//   live pipeline (the streamed loop status — which rune/gate is running now).
// Each region has its own loading/empty animation so it reads as live even when
// a region is idle or a fetch is in flight.
export function ChatPanel(): Node {
  return (
    <section data-tab="chat">
      <div class="panel wide chat">
        <h2>
          assistant
          <span class="muted">— describe → plan ($0) → run → transcript here · ⟲ history reloads past runs</span>
        </h2>
        <div class="chat-grid">
          <div class="chat-col">
            <div class="chat-region-label">conversation &amp; transcript</div>
            <div id="chat-convo" class="chat-region chat-convo">
              <div class="chat-empty">say what to build/test/refactor — or pick a path + ⟲ HISTORY to reload a past run</div>
            </div>
          </div>
          <div class="chat-col">
            <div class="chat-region-label">plan &amp; proposals <span class="muted">· $0 · no model call</span></div>
            <div id="chat-signals" class="chat-region chat-signals">
              <div class="chat-empty">the $0 plan appears here after you SEND; past runs appear after ⟲ HISTORY</div>
            </div>
          </div>
        </div>
        <div class="chat-region-label">live pipeline <span class="muted">· what's running right now</span></div>
        <div id="chat-tools" class="chat-region chat-tools">
          <div class="chat-empty">idle — the rune pipeline lights up here while a run works</div>
        </div>
        <div class="chat-input">
          <input type="text" id="chat-dir" placeholder="/path/to/project" class="chat-dir" list="chat-dirs" autocomplete="off" />
          <datalist id="chat-dirs"></datalist>
          <input type="text" id="chat-prompt" placeholder="e.g. add unit tests for the parser, or refactor the giant App component" />
          <button class="act ghost" id="chat-history" title="load this project's past runs">⟲ HISTORY</button>
          <button class="act" id="chat-send">SEND ▶</button>
        </div>
      </div>
    </section>
  );
}
