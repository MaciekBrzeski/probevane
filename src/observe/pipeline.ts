// The pipeline light-show state machine — pure, shared by the browser console
// (src/ui/app/console.tsx) and the terminal TUI. One run event moves rune
// lamps: a blocking gate flashes err, the next productive tool call cools every
// red gate to active ("retrying through"), an accept cascades all runes to ok,
// a terminal failure leaves the blockers red. Renderer-agnostic (SVG or ANSI).

export type LampState = 'idle' | 'active' | 'ok' | 'err';
export type PipelineState = Record<string, LampState>;

export interface PipelineEvent {
  tool?: string;
  gate?: string; // the rune that BLOCKED this step
  accepted?: boolean;
  stopReason?: string;
}

/** Fold one event into the lamp map; returns a NEW map (never mutates input). */
export function pipelineReducer(
  state: PipelineState,
  ev: PipelineEvent,
  runeNames: string[],
): PipelineState {
  const next: PipelineState = { ...state };
  if (ev.gate) next[ev.gate] = 'err';
  else if (ev.tool) {
    for (const k of Object.keys(next)) if (next[k] === 'err') next[k] = 'active';
  }
  if (ev.accepted) for (const r of runeNames) next[r] = 'ok';
  else if (ev.stopReason && ev.stopReason !== 'accepted') {
    for (const k of Object.keys(next)) if (next[k] === 'active') next[k] = 'err';
  }
  return next;
}

/** Cadence for theater replay: recorded gap /4, clamped to a legible window. */
export function replayDelayMs(prevTs?: string, ts?: string): number {
  const gap = prevTs && ts ? Date.parse(ts) - Date.parse(prevTs) : NaN;
  return Number.isFinite(gap) ? Math.min(1500, Math.max(250, gap / 4)) : 600;
}
