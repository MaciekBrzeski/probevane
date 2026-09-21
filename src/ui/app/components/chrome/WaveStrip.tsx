// Ambient water line under the header — the control center's state, read at a
// glance from across the room: glassy when idle, choppy while runs are active,
// raining right after a failed run. Three parallax sine layers + a recycled
// pool of rain drops, all SVG attribute writes (no innerHTML churn), driven by
// the shared motion core (30fps cap here, paused on hidden tabs, fully static
// under prefers-reduced-motion — which also keeps e2e checkpoints
// deterministic; playwright.config emulates it).
import { signal } from '../../../signals.ts';
import { MOTION, onFrame } from '../../motion.ts';

/** 0 = calm .. 1 = stormy. Fed by the poll loop (active runs raise the sea). */
export const waveEnergy = signal(0);
/** 'rain' for a stretch after a failed run; poll watcher flips it back. */
export const waveWeather = signal<'clear' | 'rain'>('clear');

const W = 1200, H = 26;
const LAYERS = [
  { amp: 3.5, len: 210, speed: 1.6, op: 0.35 },
  { amp: 5.5, len: 140, speed: 2.6, op: 0.22 },
  { amp: 8.0, len: 95, speed: 4.2, op: 0.14 },
];
const STEP = 24;   // px between wave samples — smooth enough, cheap enough
const DROPS = 16;  // recycled rain-drop pool

function wavePath(t: number, energy: number, L: { amp: number; len: number; speed: number }): string {
  const amp = L.amp * (0.35 + 1.65 * energy);
  let d = `M 0 ${H}`;
  for (let x = 0; x <= W; x += STEP) {
    const y = H * 0.55 + amp * Math.sin((x / L.len) * Math.PI * 2 + t * L.speed);
    d += ` L ${x} ${y.toFixed(1)}`;
  }
  return d + ` L ${W} ${H} Z`;
}

const NS = 'http://www.w3.org/2000/svg';

export function WaveStrip(): Node {
  const host = (<div class="wavestrip" aria-hidden="true"></div>) as HTMLElement;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const paths = LAYERS.map((L) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'var(--acc)');
    p.setAttribute('opacity', String(L.op));
    svg.appendChild(p);
    return p;
  });
  // rain pool: slanted streaks, each on its own phase; hidden while clear
  const drops = Array.from({ length: DROPS }, (_, i) => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('stroke', 'var(--acc)');
    l.setAttribute('stroke-width', '1');
    l.setAttribute('opacity', '0');
    l.dataset.seed = String((i * 733) % 1200);
    svg.appendChild(l);
    return l;
  });
  host.appendChild(svg);

  const draw = (t: number): void => {
    const e = waveEnergy.get();
    for (let i = 0; i < LAYERS.length; i++) paths[i].setAttribute('d', wavePath(t, e, LAYERS[i]));
    const raining = waveWeather.get() === 'rain';
    for (const l of drops) {
      if (!raining) { if (l.getAttribute('opacity') !== '0') l.setAttribute('opacity', '0'); continue; }
      const seed = Number(l.dataset.seed);
      const y = (t * 60 + seed) % (H + 8) - 4;
      const x = (seed + t * 14) % W;
      l.setAttribute('x1', x.toFixed(1)); l.setAttribute('y1', y.toFixed(1));
      l.setAttribute('x2', (x - 2).toFixed(1)); l.setAttribute('y2', (y + 5).toFixed(1));
      l.setAttribute('opacity', '0.45');
    }
  };

  if (!MOTION) { draw(0); return host; }

  let last = 0;
  onFrame((t) => {
    if (t - last < 0.033) return; // 30fps is plenty for water
    last = t;
    draw(t);
  });
  return host;
}
