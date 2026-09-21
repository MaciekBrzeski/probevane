// Shared animation core — ONE rAF loop for every JS-driven animation in the
// control center (WaveStrip weather, future ambience). Subscribers get seconds;
// the loop pauses on hidden tabs and never starts at all under
// prefers-reduced-motion (CSS animations respect the same media query, so one
// user preference silences the whole surface — and e2e, which emulates it,
// stays deterministic).

/** False under prefers-reduced-motion: draw one static frame, subscribe nothing. */
export const MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches;

type FrameFn = (tSec: number) => void;
const subs = new Set<FrameFn>();
let raf = 0;

function loop(now: number): void {
  raf = requestAnimationFrame(loop);
  for (const f of subs) f(now / 1000);
}
function ensure(): void {
  if (!raf && subs.size && !document.hidden && MOTION) raf = requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else ensure();
});

/** Register a per-frame callback; returns its disposer. No-ops (never fires)
 *  under reduced motion. */
export function onFrame(fn: FrameFn): () => void {
  if (!MOTION) return () => {};
  subs.add(fn);
  ensure();
  return () => { subs.delete(fn); if (!subs.size) { cancelAnimationFrame(raf); raf = 0; } };
}
