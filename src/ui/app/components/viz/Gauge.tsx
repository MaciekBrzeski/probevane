// Ring gauge — now a thin wrapper over the shared engine's `gauge` widget
// (@facet/core), drawn with a SvgPainter. The value arc is tagged `gauge-arc`
// so the existing CSS animates its draw-in; the % text is tagged `gauge-num`.
import { SvgPainter } from '@facet/render-dom';
import { gauge } from '@facet/core';
import { packed } from '../../../../util/theme.ts';

// Draws one ring gauge through the engine widget and wraps it with its label —
// SVG lands via innerHTML because the painter emits a string, not DOM nodes.
export function Gauge(props: { value: number; label: string; accent?: number; size?: number }): Node {
  const size = props.size ?? 96;
  const p = new SvgPainter(size, size);
  gauge(p, {
    cx: size / 2, cy: size / 2, r: size / 2 - 8, value: props.value,
    accent: props.accent ?? packed('acc'), track: packed('line'),
    trackTag: 'gauge-track', valueTag: 'gauge-arc', valuePathLength: 1,
  });
  const t = p.items.find((i) => i.tag === 'text'); if (t) t.attrs.class = 'gauge-num';
  const host = document.createElement('div');
  host.innerHTML = p.toSvg(); // trusted: SVG built from numbers only
  return (
    <div class="gauge-wrap">
      {host.firstChild!}
      <div class="gauge-label">{props.label}</div>
    </div>
  );
}
