// SVG ring gauge — value 0..1 drawn as a glowing arc (stroke-dashoffset
// animates the sweep via the .gauge-arc CSS). Pure render; callers re-mount
// to update.
export function Gauge(props: { value: number; label: string; color?: string; size?: number }): Node {
  const size = props.size ?? 96;
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, props.value));
  const color = props.color ?? 'var(--acc)';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'gauge');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.innerHTML =
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="6" opacity="0.5"/>` +
    `<circle class="gauge-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="6" ` +
    `stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})" ` +
    `stroke-dasharray="${c.toFixed(1)}" style="--dash:${(c * (1 - v)).toFixed(1)}; stroke-dashoffset:${(c * (1 - v)).toFixed(1)}"/>` +
    `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" class="gauge-num">${Math.round(v * 100)}%</text>`;
  return (
    <div class="gauge-wrap">
      {svg}
      <div class="gauge-label">{props.label}</div>
    </div>
  );
}
