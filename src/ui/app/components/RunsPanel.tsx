// Runs tab: active runs box + run-history table (tbody swapped by loadRuns()).
export function RunsPanel(): Node {
  return (
    <section data-tab="runs">
      <div class="panel wide" style="margin-bottom:12px">
        <h2>active runs</h2>
        <div id="activeRuns" class="muted">no active runs</div>
      </div>
      <div class="panel wide">
        <h2>run history <span id="runsMeta" class="muted"></span></h2>
        <table id="runs"><thead><tr><th>when</th><th>label</th><th>model</th><th>status</th><th>cost</th><th>steps</th></tr></thead><tbody><tr><td class="muted" colSpan={6}>loading…</td></tr></tbody></table>
      </div>
    </section>
  );
}
