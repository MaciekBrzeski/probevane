// Glow area sparkline — now a thin wrapper over the shared engine's `sparkline`
// widget (@facet/core) with a SvgPainter: gradient area + a `spark-line`-tagged
// self-drawing stroke + a `spark-dot` end circle (both CSS-animated as before).
import { SvgPainter } from '@facet/render-dom';
import { sparkline } from '@facet/core';
import { packed } from '../../../../util/theme.ts';

export function Spark(props: { points: number[]; label: string; accent?: number; width?: number; height?: number }): Node {
  const w = props.width ?? 260;
  const ht = props.height ?? 64;
  const accent = props.accent ?? packed('acc');
  const pts = props.points.length ? props.points : [0];
  const p = new SvgPainter(w, ht);
  sparkline(p, { rect: { x: 0, y: 6, w, h: ht - 16 }, points: pts, accent, area: true, strokeWidth: 2, tag: 'spark-line', pathLength: 1 });
  const max = Math.max(1e-9, ...pts);
  const lastY = 6 + (ht - 16) - (pts[pts.length - 1]! / max) * (ht - 16);
  p.circle(w, lastY, 3, { fill: accent, tag: 'spark-dot' });
  const host = document.createElement('div');
  host.innerHTML = p.toSvg(); // trusted: SVG built from numbers only
  return (
    <div class="spark-wrap">
      <div class="spark-label">{props.label}</div>
      {host.firstChild!}
    </div>
  );
}
