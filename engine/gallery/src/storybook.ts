// In-terminal storybook — the same ENTRIES catalog, browsable live in the tty.
// Dogfoods facet: the storybook chrome (frame, list, tabs, keyValue) is itself
// drawn with facet widgets, and each component is rendered into a cell Screen and
// blitted into the preview pane. ↑↓/j/k pick a component; q quits.

import { CellPainter, putText, blit, serialize, diff, type Screen } from '@facet/render-term';
import { frame, list, spinner } from '@facet/core';
import { ENTRIES, type Entry } from './gallery';

const PAL = {
  bg: 0x04070f, panel: 0x0b1220, line: 0x1b2a44, fg: 0xcfe3f5, dim: 0x7d93ad,
  ok: 0x2fe6a8, acc: 0x4fd6ff, mag: 0xc792ea,
};

const LIST_W = 18; // left rail width

/** Render one frame of the storybook to a Screen at the given size + selection + tick. */
export function renderStorybook(w: number, h: number, sel: number, t: number): Screen {
  const e = ENTRIES[sel]!;
  const p = new CellPainter(w, h);
  p.clear(PAL.bg);
  // outer frame + panels
  frame(p, { x: 0, y: 0, w, h }, { title: 'facet storybook', accent: PAL.acc, panel: PAL.panel, line: PAL.line });
  // left rail: the component index, windowed so the selection stays visible.
  const vis = h - 4;
  const start = Math.max(0, Math.min(sel - (vis >> 1), ENTRIES.length - vis));
  const win = ENTRIES.slice(start, start + vis);
  list(p, {
    rect: { x: 2, y: 2, w: LIST_W, h: vis },
    items: win.map((x) => x.name), selected: sel - start, accent: PAL.acc, dim: PAL.dim,
  });
  const scr = p.flush();
  if (start > 0) putText(scr, 2 + LIST_W, 2, '▲', { fg: PAL.dim });
  if (start + vis < ENTRIES.length) putText(scr, 2 + LIST_W, h - 3, '▼', { fg: PAL.dim });
  // divider between rail + detail
  const dx = LIST_W + 3;
  for (let y = 2; y < h - 2; y++) putText(scr, dx, y, '│', { fg: PAL.line });

  // detail pane
  const px = dx + 2;
  putText(scr, px, 2, e.name, { fg: PAL.acc, bold: true });
  putText(scr, px, 3, e.desc, { fg: PAL.fg });
  putText(scr, px, 5, 'PREVIEW', { fg: PAL.dim });
  blitPreview(scr, e, px, 6, t);

  const uy = Math.min(h - 4, 6 + Math.max(e.h, 3) + 1);
  putText(scr, px, uy, 'USAGE', { fg: PAL.dim });
  putText(scr, px, uy + 1, e.usage, { fg: PAL.ok });

  putText(scr, 2, h - 1, ' ↑↓/jk move · q quit ', { fg: PAL.dim, bg: PAL.panel });
  putText(scr, w - 18, h - 1, `${sel + 1}/${ENTRIES.length} `, { fg: PAL.dim, bg: PAL.panel });
  return scr;
}

/** Render a component into its own Screen and blit it into the detail pane. */
function blitPreview(scr: Screen, e: Entry, x: number, y: number, t: number): void {
  const sub = new CellPainter(e.w + 1, Math.max(e.h, 1) + 1);
  sub.clear(PAL.panel);
  // spinner is the one animated entry — redraw it with the live tick (the static
  // ENTRIES.draw hard-codes a frame); everything else is drawn as authored.
  if (e.name === 'spinner') spinner(sub, { x: 0, y: 0, accent: PAL.acc }, t);
  else e.draw(sub);
  blit(scr, sub.flush(), x, y);
}

/** Run the interactive TUI (alt-screen, raw keys) until q/Ctrl-C. */
export function run(): void {
  const out = process.stdout;
  const size = (): [number, number] => [Math.min(out.columns ?? 100, 110), Math.min(out.rows ?? 32, 40)];
  let sel = 0;
  let prev: Screen | null = null;
  let t = 0;

  out.write('\x1b[?1049h\x1b[?25l'); // alt-screen + hide cursor
  const draw = (full = false): void => {
    const [w, h] = size();
    const scr = renderStorybook(w, h, sel, t);
    if (full) { out.write(serialize(scr)); prev = scr; return; }
    out.write(diff(prev, scr));
    prev = scr;
  };
  const cleanup = (): void => {
    clearInterval(timer);
    out.write('\x1b[?25h\x1b[?1049l'); // show cursor + leave alt-screen
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  };

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('data', (buf: Buffer) => {
    const k = buf.toString();
    if (k === 'q' || k === '\x03') { cleanup(); process.exit(0); }
    else if (k === '\x1b[A' || k === 'k') sel = (sel - 1 + ENTRIES.length) % ENTRIES.length;
    else if (k === '\x1b[B' || k === 'j') sel = (sel + 1) % ENTRIES.length;
    else return;
    draw();
  });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  out.on('resize', () => draw(true));

  const timer = setInterval(() => { t += 120; draw(); }, 120); // drive the spinner
  draw(true);
}
