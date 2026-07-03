import { $, j } from './lib.ts';

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
    g.appendChild(<Gauge value={a.totals.acceptRate} label="acceptance" />);
    g.appendChild(<Gauge value={Math.min(1, a.totals.runs / 500)} label="runs/500" color="var(--warn2)" />);
    const sp = $('sparks'); sp.textContent = '';
    sp.appendChild(<Spark points={a.daily.map((d: { cost: number }) => d.cost)} label="cost / day" />);
    sp.appendChild(<Spark points={a.daily.map((d: { tokensOut: number }) => d.tokensOut)} label="tokens out / day" color="var(--mag)" />);
  } catch (e) { console.error('telemetry', e); }
  try {
    const g = await j('/graph');
    type GN = { path: string; imports: string[]; fanIn: number; callsNetwork: boolean };
    // Top hubs by fan-in, then drop anything with no edge INSIDE the kept set —
    // a constellation is about connections, isolated nodes are noise here.
    const pool: GN[] = (g.nodes as GN[]).sort((a, b) => b.fanIn - a.fanIn).slice(0, 40);
    const poolIds = new Set(pool.map((n) => n.path));
    const linked = new Set<string>();
    for (const n of pool) for (const d of n.imports) if (poolIds.has(d)) { linked.add(n.path); linked.add(d); }
    const top: GN[] = pool.filter((n) => linked.has(n.path)).slice(0, 24);
    const keep = new Set(top.map((n) => n.path));
    const maxFan = Math.max(1, ...top.map((n) => n.fanIn));
    const nodes = top.map((n) => ({
      id: n.path, label: n.path.split('/').pop()!.replace(/\.[tj]sx?$/, ''),
      title: `${n.path} · fan-in ${n.fanIn}`, deps: n.imports.filter((d) => keep.has(d)),
      weight: n.fanIn / maxFan, state: (n.callsNetwork ? 'err' : n.fanIn / maxFan > 0.5 ? 'active' : 'idle') as 'idle',
    }));
    const box = $('constellation'); box.textContent = '';
    box.appendChild(<NodeGraph nodes={nodes} />);
  } catch { $('constellation').textContent = 'graph unavailable'; }
}

// Live pipeline — the light show. SSE run events accumulate into a persistent
// state map: a blocking gate flashes err, the next productive tool call cools
// it to active ("retrying through"), accept cascades every rune to ok, a
// terminal failure leaves the blockers red. openRunLive feeds this.
let PIPE_STATE: Record<string, 'idle' | 'active' | 'ok' | 'err'> = {};

export function consolePipelineEvent(ev: { tool?: string; gate?: string; accepted?: boolean; stopReason?: string }) {
  if (!PIPE_RUNES.length) return;
  if (ev.gate) PIPE_STATE[ev.gate] = 'err';
  else if (ev.tool) {
    // Progress after a block: the red gate is being worked through.
    for (const k of Object.keys(PIPE_STATE)) if (PIPE_STATE[k] === 'err') PIPE_STATE[k] = 'active';
  }
  if (ev.accepted) for (const r of PIPE_RUNES) PIPE_STATE[r.name] = 'ok';
  else if (ev.stopReason && ev.stopReason !== 'accepted') {
    for (const k of Object.keys(PIPE_STATE)) if (PIPE_STATE[k] === 'active') PIPE_STATE[k] = 'err';
  }
  renderPipeline(PIPE_STATE);
}

/** New run watched → clear the previous run's lights. */
export function consolePipelineReset() {
  PIPE_STATE = {};
  renderPipeline(PIPE_STATE);
}
