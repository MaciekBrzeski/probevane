// Cost / Alerts tab: daily cost bars, alerts list, library audit trail (poll()).
export function CostPanel(): Node {
  return (
    <section data-tab="cost">
      <div class="grid">
        <div class="panel"><h2>cost / day</h2><div class="bars" id="bars"></div><div class="muted" id="aggMeta" style="margin-top:8px"></div></div>
        <div class="panel"><h2>alerts</h2><div id="alerts" class="muted">none</div></div>
        <div class="panel wide"><h2>library audit trail</h2><pre id="audit" class="muted">–</pre></div>
      </div>
    </section>
  );
}
