// Render a cell Screen to HTML — one <span> per cell with its packed fg/bg. Lets
// the browser show the EXACT terminal output next to the SVG, so the gallery
// proves cell↔SVG parity visually.

import type { Screen } from '@facet/render-term';

const hex = (n: number | undefined, fallback: string): string => (n === undefined ? fallback : '#' + n.toString(16).padStart(6, '0'));
const esc = (c: string): string => (c === ' ' ? ' ' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);

export function cellHtml(s: Screen, bg = 0x04070f): string {
  let out = `<pre class="cells" style="margin:0;background:${hex(bg, '#04070f')}">`;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const c = s.cells[y * s.w + x]!;
      const style = `color:${hex(c.st.fg, '#cfe3f5')}` +
        (c.st.bg !== undefined ? `;background:${hex(c.st.bg, '')}` : '') +
        (c.st.bold ? ';font-weight:700' : '');
      out += `<span style="${style}">${esc(c.ch)}</span>`;
    }
    out += '\n';
  }
  return out + '</pre>';
}
