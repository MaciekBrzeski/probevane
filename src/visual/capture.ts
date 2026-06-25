import { chromium } from 'playwright';

// Screenshot a page (or one element) for the visual-improvement loop: render →
// capture → a vision model judges → edit → repeat. Thin Playwright wrapper.
export interface CaptureOpts {
  /** CSS selector to shoot just one element (else the full page). */
  selector?: string;
  /** Viewport width (default 1400 — wide enough for diagrams). */
  width?: number;
  height?: number;
  /** ms to wait after load (let Mermaid/JS render). */
  settleMs?: number;
}

export async function capture(url: string, out: string, opts: CaptureOpts = {}): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: opts.width ?? 1400, height: opts.height ?? 900 } });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(opts.settleMs ?? 1500);
    if (opts.selector) {
      const el = page.locator(opts.selector).first();
      await el.waitFor({ state: 'visible', timeout: 10_000 });
      await el.screenshot({ path: out });
    } else {
      await page.screenshot({ path: out, fullPage: true });
    }
    return out;
  } finally {
    await browser.close();
  }
}
