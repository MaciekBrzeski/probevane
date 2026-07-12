// The Trek console tab: live rune pipeline (nodes light up over SSE) +
// project module constellation + ring gauges/sparks fed by /aggregate.
// Regions + accents + positions come from the shared theme SSOT (CONSOLE_PANES)
// — the SAME manifest the terminal console lays out from (spanToBox). Each
// pane is absolutely positioned by its span; inner containers are filled by
// main.tsx (loadConsole/consoleTick).
import { CONSOLE_PANES, cssVar, spanToCss } from '../../../../util/theme.ts';

const PANE_BODY: Record<string, () => Node> = {
  pipeline: () => (
    <>
      <div id="pipelineGraph" class="muted">standby…</div>
      <div id="theaterTicker" class="theater-ticker"></div>
    </>
  ),
  telemetry: () => (
    <>
      <div class="gauges" id="gauges"></div>
      <div id="sparks"></div>
    </>
  ),
  constellation: () => <div id="constellation" class="muted">standby…</div>,
};

// Console-tab skeleton: one ScanFrame per CONSOLE_PANES entry, body picked by
// pane id — layout stays a pure function of the shared manifest.
export function ConsolePanel(): Node {
  return (
    <section data-tab="console">
      <div class="console-grid">
        {CONSOLE_PANES.map((p) => (
          <div class="console-pane" style={spanToCss(p.span)}>
            <ScanFrame title={p.title} accent={cssVar(p.accent)}>{PANE_BODY[p.id]()}</ScanFrame>
          </div>
        ))}
      </div>
    </section>
  );
}
