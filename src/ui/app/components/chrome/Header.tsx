// Sticky header: title, health, headline cost/accept/alert stats, pipeline link.
export function Header(): Node {
  return (
    <header>
      <h1>probevane <span class="muted">control center</span></h1>
      <span class="stat"><span id="healthDot" class="dot" style="background:var(--dim)"></span><span id="health" class="connecting">connecting…</span></span>
      <span class="stat">cost <b id="cost">–</b> · accept <b id="accept">–</b> · alerts <b id="alertN">–</b></span>
      <span class="spacer"></span>
      <a href="/demo/pipeline" target="_blank">pipeline ↗</a>
    </header>
  );
}
