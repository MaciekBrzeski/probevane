// The Trek console tab: live rune pipeline (nodes light up over SSE) +
// project module constellation + ring gauges/sparks fed by /aggregate.
// Containers are filled by main.tsx (loadConsole/consoleTick).
export function ConsolePanel(): Node {
  return (
    <section data-tab="console">
      <div class="console-grid">
        <div class="sf-hero">
          <ScanFrame title="run pipeline" accent="var(--acc)">
            <div id="pipelineGraph" class="muted">standby…</div>
            <div id="theaterTicker" class="theater-ticker"></div>
          </ScanFrame>
        </div>
        <ScanFrame title="telemetry" accent="var(--warn2)">
          <div class="gauges" id="gauges"></div>
          <div id="sparks"></div>
        </ScanFrame>
        <ScanFrame title="module constellation" accent="var(--mag)">
          <div id="constellation" class="muted">standby…</div>
        </ScanFrame>
      </div>
    </section>
  );
}
