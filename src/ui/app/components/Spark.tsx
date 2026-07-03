// Glow area sparkline — an SVG path over a gradient fill; the stroke draws
// itself in via the .spark-line CSS (pathLength=1 normalizes the dash trick).
export function Spark(props: { points: number[]; label: string; color?: string; width?: number; height?: number }): Node {
  const w = props.width ?? 260;
  const ht = props.height ?? 64;
  const color = props.color ?? 'var(--acc)';
  const pts = props.points.length ? props.points : [0];
  const max = Math.max(1e-9, ...pts);
  const step = pts.length > 1 ? w / (pts.length - 1) : w;
  const xy = pts.map((p, i) => `${(i * step).toFixed(1)},${(ht - 6 - (p / max) * (ht - 16)).toFixed(1)}`);
  const gid = `sg-${props.label.replace(/\W/g, '')}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  svg.setAttribute('class', 'spark');
  svg.innerHTML =
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<polygon points="0,${ht} ${xy.join(' ')} ${w},${ht}" fill="url(#${gid})"/>` +
    `<polyline class="spark-line" points="${xy.join(' ')}" fill="none" stroke="${color}" stroke-width="2" pathLength="1"/>` +
    `<circle cx="${xy[xy.length - 1].split(',')[0]}" cy="${xy[xy.length - 1].split(',')[1]}" r="3" fill="${color}" class="spark-dot"/>`;
  return (
    <div class="spark-wrap">
      <div class="spark-label">{props.label}</div>
      {svg}
    </div>
  );
}
