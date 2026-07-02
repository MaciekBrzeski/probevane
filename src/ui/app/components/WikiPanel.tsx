// Docs tab (wiki folded in): page list + rendered markdown pane.
export function WikiPanel(): Node {
  return (
    <section data-tab="docs">
      <div class="grid">
        <div class="panel"><h2>pages</h2><div id="wikiList" class="muted">loading…</div></div>
        <div class="panel"><h2 id="docTitle">select a page</h2><div id="docBody" class="md muted">click a page to render it here.</div></div>
      </div>
    </section>
  );
}
