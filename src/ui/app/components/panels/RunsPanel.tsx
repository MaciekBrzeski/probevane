// Runs tab: active runs box + run-history table (tbody swapped by loadRuns()).
// Column headers come from the shared RUN_COLUMNS schema — the SAME columns the
// terminal run list renders.
import { RUN_COLUMNS } from '../../../../util/theme.ts';

// Static Runs-tab skeleton — loadRuns() in main.tsx swaps in the live tbody +
// active-runs box, so this markup only renders once.
export function RunsPanel(): Node {
  return (
    <section data-tab="runs">
      <div class="panel wide" style="margin-bottom:12px">
        <h2>active runs</h2>
        <div id="activeRuns" class="muted">no active runs</div>
      </div>
      <div class="panel wide">
        <h2>run history <span id="runsMeta" class="muted"></span></h2>
        <table id="runs">
          <thead><tr>{RUN_COLUMNS.map((c) => <th>{c.header}</th>)}</tr></thead>
          <tbody><tr><td class="muted" colSpan={RUN_COLUMNS.length}>loading…</td></tr></tbody>
        </table>
      </div>
    </section>
  );
}
