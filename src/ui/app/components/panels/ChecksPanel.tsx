// Checks tab shell — the gate scoreboard. Static frame only: main.tsx's
// loadChecks() fetches /checks and fills #checks-body with gauges, the eval
// sparkline, crowding bars and gate lamps (built client-side from live data).
export function ChecksPanel(): Node {
  return (
    <section data-tab="checks">
      <div class="panel wide">
        <h2>checks <span id="checksmeta" class="muted"></span></h2>
        <div id="checks-body" class="muted">loading gate scoreboard…</div>
      </div>
    </section>
  );
}
