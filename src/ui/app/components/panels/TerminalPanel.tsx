// Terminal tab: xterm mounted in an LCARS frame, driven by src/ui/app/terminal.ts.
// Toolbar presets spawn a session; the div#termMount is where xterm attaches.
export function TerminalPanel(): Node {
  return (
    <section data-tab="terminal">
      <ScanFrame title="terminal" accent="var(--ok)">
        <div class="term-toolbar">
          <button class="ghost" id="termBash">bash</button>
          <button class="ghost" id="termClaude">claude</button>
          <button class="ghost" id="termKill">kill</button>
          <span id="termMsg" class="muted"></span>
        </div>
        <div id="termMount" class="term-mount"></div>
      </ScanFrame>
    </section>
  );
}
