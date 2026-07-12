import { $, j } from './lib.ts';
import { gauges, packed } from '../../util/theme.ts';
import { constellation } from '../../observe/constellation.ts';
import { pipelineReducer, replayDelayMs, type PipelineState } from '../../observe/pipeline.ts';

// --- console tab: rune pipeline + telemetry + module constellation ----------
type PipeRune = { name: string; phase: string; summary: string };
let PIPE_RUNES: PipeRune[] = [];

function renderPipeline(states: Record<string, 'idle' | 'active' | 'ok' | 'err'> = {}) {
  if (!PIPE_RUNES.length) return;
  const nodes = PIPE_RUNES.map((r, i) => ({
    id: r.name, label: r.name, title: `${r.phase}: ${r.summary}`,
    deps: i ? [PIPE_RUNES[i - 1].name] : [], state: states[r.name] ?? 'idle',
  }));
  const box = $('pipelineGraph'); box.textContent = '';
  box.appendChild(<NodeGraph nodes={nodes} id="pipeSvg" compact={true} />);
}

export async function loadConsole() {
  try {
    const p = await j('/pipeline');
    PIPE_RUNES = p.runes.map((r: PipeRune) => ({ name: r.name, phase: r.phase, summary: r.summary }));
    renderPipeline();
  } catch { $('pipelineGraph').textContent = 'pipeline unavailable'; }
  try {
    const a = await j('/aggregate');
    const g = $('gauges'); g.textContent = '';
    for (const spec of gauges(a.totals)) g.appendChild(<Gauge value={spec.value} label={spec.label} accent={packed(spec.accent)} />);
    const sp = $('sparks'); sp.textContent = '';
    sp.appendChild(<Spark points={a.daily.map((d: { cost: number }) => d.cost)} label="cost / day" accent={packed('acc')} />);
    sp.appendChild(<Spark points={a.daily.map((d: { tokensOut: number }) => d.tokensOut)} label="tokens out / day" accent={packed('mag')} />);
  } catch (e) { console.error('telemetry', e); }
  try {
    const g = await j('/graph');
    // Hub selection is shared with the terminal console (src/observe/constellation.ts).
    const nodes = constellation(g.nodes).map((n) => ({
      id: n.id, label: n.label, title: n.title, deps: n.deps, weight: n.weight, state: n.state,
    }));
    const box = $('constellation'); box.textContent = '';
    box.appendChild(<NodeGraph nodes={nodes} />);
  } catch { $('constellation').textContent = 'graph unavailable'; }
}

// Live pipeline — the light show. SSE run events accumulate into a persistent
// state map: a blocking gate flashes err, the next productive tool call cools
// it to active ("retrying through"), accept cascades every rune to ok, a
// terminal failure leaves the blockers red. openRunLive feeds this.
let PIPE_STATE: PipelineState = {};

export function consolePipelineEvent(ev: { tool?: string; gate?: string; accepted?: boolean; stopReason?: string }) {
  if (!PIPE_RUNES.length) return;
  PIPE_STATE = pipelineReducer(PIPE_STATE, ev, PIPE_RUNES.map((r) => r.name));
  renderPipeline(PIPE_STATE);
}

/** New run watched → clear the previous run's lights. */
export function consolePipelineReset() {
  PIPE_STATE = {};
  renderPipeline(PIPE_STATE);
}

// --- Theater: replay a CAPTURED run's light show from its durable event
// stream (no loop, no model — pure playback). Cadence follows the recorded
// timestamps, clamped so long thinks don't stall the show and bursts stay
// legible. One theater at a time.
type TheaterEvent = { ts?: string; step?: number; tool?: string; gate?: string; accepted?: boolean; stopReason?: string };
let THEATER_TIMER: ReturnType<typeof setTimeout> | null = null;

/** Fetch a captured run's durable events and play them (ticker included). */
export async function startTheater(runId: string): Promise<boolean> {
  try {
    const { events } = await j('/events?runId=' + encodeURIComponent(runId));
    const ticker = $('theaterTicker');
    ticker.textContent = `\u25b6 replaying ${runId}`;
    consoleTheater(runId, events, (line) => { ticker.textContent = `\u25b6 ${runId}  ${line}`; });
    return true;
  } catch {
    return false;
  }
}

export function consoleTheater(runId: string, events: TheaterEvent[], onTick?: (line: string, i: number) => void) {
  if (THEATER_TIMER) clearTimeout(THEATER_TIMER);
  consolePipelineReset();
  const line = (e: TheaterEvent) =>
    `[step ${e.step ?? '?'}] ${e.gate ? 'BLOCK ' + e.gate : e.accepted ? 'ACCEPTED' : e.stopReason ?? e.tool ?? ''}`;
  const play = (i: number) => {
    if (i >= events.length) { THEATER_TIMER = null; return; }
    consolePipelineEvent(events[i]);
    onTick?.(line(events[i]), i);
    THEATER_TIMER = setTimeout(() => play(i + 1), replayDelayMs(events[i]?.ts, events[i + 1]?.ts));
  };
  play(0);
}
