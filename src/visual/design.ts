import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { visionAsk } from './vision.js';
import { extractFence } from './improve.js';

// Combined design loop: WRITE a Playwright spec that screenshots each page/tab →
// RUN it (capture) → a vision model JUDGES each shot for design practice → REWRITE
// the page's CSS to address the findings → re-capture → repeat. One invocation
// turns "screenshot every page" + "improve the design" into a single gated loop,
// and leaves the spec behind as a permanent visual-regression test.
//
// The rewrite is scoped to CSS ONLY — design lives in CSS (contrast, spacing,
// hierarchy, alignment), and leaving markup/JS untouched keeps behaviour (and
// the XSS/asset guarantees) intact. Targets: an html file's first <style>
// block, or a raw .css file (the control center's TSX build — under
// PROBEVANE_UI_DEV the daemon recompiles per request, so each rewrite is live
// on the next screenshot without any rebuild step).

export interface DesignPage {
  name: string;
  /** Selectors to click (in order) before the shot — e.g. a tab button. */
  clicks?: string[];
}

export interface DesignOpts {
  url: string;
  targetFile: string; // the html file whose <style> the loop rewrites
  pages: DesignPage[];
  goal: string;
  outDir: string;
  specFile?: string; // where to write the emitted screenshot spec
  rounds?: number;
  width?: number;
  settleMs?: number;
  log?: (l: string) => void;
  /** Injectable seams (tests drive the loop without a browser/model). Default to the real fns. */
  capture?: typeof capturePages;
  ask?: (imagePath: string, system: string, user: string) => Promise<string>;
}

const JUDGE_SYSTEM =
  'You are a senior product designer reviewing a rendered UI screenshot against modern design practice ' +
  '(visual hierarchy, contrast/legibility, spacing rhythm, alignment, density, consistency). ' +
  'List the 3 most impactful, concrete CSS-level improvements as short bullets. ' +
  'If the page already follows good practice, reply EXACTLY "OK".';

const REWRITE_SYSTEM =
  'You improve a web page\'s CSS toward design findings. You are given the current contents of a <style> ' +
  'block and a list of findings. Return ONLY the complete revised CSS inside a single fenced code block — ' +
  'no <style> tags, no prose. Keep every existing selector/class name (markup and JS depend on them); ' +
  'you may adjust their properties and add new rules. Make focused, tasteful changes — do not restyle wholesale.';

/**
 * The selector heads of a stylesheet (crude but stable: text before each `{`,
 * split on commas). Used as the rewrite CONTRACT: markup/JS depend on these,
 * so a rewrite that loses selectors gets reverted — the vision model is asked
 * to keep them, but small local models don't reliably honor instructions
 * (the LoRA lesson: convention learned, contracts not bound). Gate, don't trust.
 */
export function cssSelectors(css: string): Set<string> {
  const out = new Set<string>();
  const noAt = css.replace(/@media[^{]*\{|@keyframes[^{]*\{[\s\S]*?\}\s*\}/g, '');
  for (const m of noAt.matchAll(/(^|\})\s*([^{}@/]+)\{/g)) {
    for (const sel of m[2].split(',')) {
      const s = sel.trim();
      if (s) out.add(s);
    }
  }
  return out;
}

/** The <style>…</style> body of an html file (first block), or null. */
export function extractStyle(html: string): { css: string; start: number; end: number } | null {
  const open = html.indexOf('<style>');
  const close = html.indexOf('</style>', open + 1);
  if (open === -1 || close === -1) return null;
  return { css: html.slice(open + '<style>'.length, close), start: open + '<style>'.length, end: close };
}

/** Splice a new CSS body back into the html's first <style> block. */
export function spliceStyle(html: string, css: string): string {
  const s = extractStyle(html);
  if (!s) return html;
  return html.slice(0, s.start) + '\n' + css.trim() + '\n' + html.slice(s.end);
}

/** Screenshot each page/tab in one browser session (click selectors, then shoot). */
export async function capturePages(
  url: string,
  pages: DesignPage[],
  outDir: string,
  round: number,
  opts: { width?: number; settleMs?: number } = {},
): Promise<{ name: string; path: string }[]> {
  const browser = await chromium.launch();
  const shots: { name: string; path: string }[] = [];
  try {
    for (const p of pages) {
      const page = await browser.newPage({ viewport: { width: opts.width ?? 1400, height: 900 } });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(opts.settleMs ?? 1500);
      for (const sel of p.clicks ?? []) await page.locator(sel).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const path = join(outDir, `r${round}-${p.name}.png`);
      await page.screenshot({ path, fullPage: true });
      await page.close();
      shots.push({ name: p.name, path });
    }
  } finally {
    await browser.close();
  }
  return shots;
}

/** Emit a standalone Playwright spec that screenshots every page/tab — the
 *  "write test" half of the loop, kept as a permanent visual-regression artifact. */
export function specSource(url: string, pages: DesignPage[]): string {
  const cases = pages
    .map((p) => {
      const clicks = (p.clicks ?? []).map((s) => `  await page.locator(${JSON.stringify(s)}).first().click();`).join('\n');
      return `test('screenshot: ${p.name}', async ({ page }) => {\n` +
        `  await page.goto(${JSON.stringify(url)});\n${clicks}\n` +
        `  await page.waitForTimeout(800);\n` +
        `  await expect(page).toHaveScreenshot('${p.name}.png', { fullPage: true, maxDiffPixelRatio: 0.02 });\n});`;
    })
    .join('\n\n');
  return `import { test, expect } from '@playwright/test';\n\n// Generated by \`probevane design\` — visual baseline per page/tab.\n${cases}\n`;
}

export interface DesignRound {
  round: number;
  findings: { name: string; text: string }[];
  edited: boolean;
}

export async function designLoop(opts: DesignOpts): Promise<{ rounds: DesignRound[]; shots: string[] }> {
  const log = opts.log ?? (() => {});
  const capture = opts.capture ?? capturePages;
  const ask = opts.ask ?? visionAsk;
  const rounds = opts.rounds ?? 2;
  await mkdir(opts.outDir, { recursive: true });
  if (opts.specFile) {
    await writeFile(opts.specFile, specSource(opts.url, opts.pages));
    log(`[design] wrote screenshot spec → ${opts.specFile}`);
  }
  const history: DesignRound[] = [];
  const allShots: string[] = [];

  for (let r = 1; r <= rounds; r++) {
    const capOpts = { width: opts.width, settleMs: opts.settleMs };
    const shots = await capture(opts.url, opts.pages, opts.outDir, r, capOpts);
    allShots.push(...shots.map((s) => s.path));
    const findings: { name: string; text: string }[] = [];
    for (const s of shots) {
      const verdict = (await ask(s.path, JUDGE_SYSTEM, `GOAL: ${opts.goal}\nPAGE: ${s.name}`)).trim();
      findings.push({ name: s.name, text: verdict });
      log(`[design] r${r} judge ${s.name}: ${/^OK\b/i.test(verdict) ? 'OK' : verdict.split('\n')[0].slice(0, 80)}`);
    }
    const actionable = findings.filter((f) => !/^OK\b/i.test(f.text));
    if (!actionable.length) { history.push({ round: r, findings, edited: false }); log(`[design] r${r}: all pages OK — stopping`); break; }

    const isCss = opts.targetFile.endsWith('.css');
    const source = await readFile(opts.targetFile, 'utf8');
    const style = isCss ? { css: source } : extractStyle(source);
    if (!style) { log('[design] no <style> block in target — cannot rewrite'); history.push({ round: r, findings, edited: false }); break; }
    const findingText = actionable.map((f) => `## ${f.name}\n${f.text}`).join('\n\n');
    const worst = shots.find((s) => s.name === actionable[0].name)!.path;
    const reply = await ask(worst, REWRITE_SYSTEM, `FINDINGS:\n${findingText}\n\nCURRENT CSS:\n${style.css}`);
    const nextCss = extractFence(reply);
    if (!nextCss) { log(`[design] r${r}: no CSS returned — stopping`); history.push({ round: r, findings, edited: false }); break; }
    // Selector-preservation gate: the rewrite must keep every selector the
    // markup/JS depend on. A rewrite that drops any is discarded, not applied.
    const kept = cssSelectors(nextCss);
    const lost = [...cssSelectors(style.css)].filter((s) => !kept.has(s));
    if (lost.length) {
      log(`[design] r${r}: rewrite DROPPED ${lost.length} selector(s) (${lost.slice(0, 3).join(', ')}${lost.length > 3 ? ', …' : ''}) — reverted, not applied`);
      history.push({ round: r, findings, edited: false });
      continue;
    }
    await writeFile(opts.targetFile, isCss ? nextCss.trim() + '\n' : spliceStyle(source, nextCss));
    history.push({ round: r, findings, edited: true });
    log(`[design] r${r}: rewrote ${isCss ? 'the stylesheet' : '<style>'} in ${opts.targetFile} (${actionable.length} page(s) with findings)`);
  }
  return { rounds: history, shots: allShots };
}
