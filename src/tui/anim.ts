// Colour/anim math (pulse/mix/glow) now lives in @facet/core. `gaugeBar` is a
// terminal-specific bracket bar kept here (the engine's gauge widget is a ring).
export { pulse, mix, glow } from '@facet/core';

const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);

/** Bracketed block gauge `⟦████░░⟧` — value 0..1, `reveal` 0..1 sweeps the fill in. */
export function gaugeBar(value: number, width: number, reveal = 1): string {
  const w = Math.max(1, Math.floor(width));
  const shown = Math.round(w * clamp01(value) * clamp01(reveal));
  return '⟦' + '█'.repeat(shown) + '░'.repeat(w - shown) + '⟧';
}
