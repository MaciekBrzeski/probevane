import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractStyle, spliceStyle, specSource, designLoop, cssSelectors, type DesignPage, type DesignOpts } from '../src/visual/design.js';
import { usesOpenAiVision } from '../src/visual/vision.js';

describe('design.extractStyle / spliceStyle', () => {
  const html = '<html><head><style>\n.a { color: red; }\n</style></head><body>hi</body></html>';
  it('extracts the first style block body', () => {
    const s = extractStyle(html);
    expect(s).not.toBeNull();
    expect(s!.css).toContain('.a { color: red; }');
  });
  it('returns null when there is no style block', () => {
    expect(extractStyle('<html><body>no style</body></html>')).toBeNull();
  });
  it('splices new css back, leaving markup + body untouched', () => {
    const out = spliceStyle(html, '.a { color: blue; }');
    expect(out).toContain('.a { color: blue; }');
    expect(out).not.toContain('color: red');
    expect(out).toContain('<body>hi</body>');   // markup preserved
    expect(out).toContain('<style>');            // still a style block
    expect(out).toContain('</style>');
  });
  it('spliceStyle is a no-op when there is no style block', () => {
    const noStyle = '<html><body>x</body></html>';
    expect(spliceStyle(noStyle, '.a{}')).toBe(noStyle);
  });
});

describe('design.specSource', () => {
  const src = specSource('http://localhost:7766/', [
    { name: 'projects' },
    { name: 'runs', clicks: ['nav.tabs button[data-go="runs"]'] },
  ]);
  it('emits a playwright spec with one test per page', () => {
    expect(src).toContain("import { test, expect } from '@playwright/test'");
    expect(src).toContain("test('screenshot: projects'");
    expect(src).toContain("test('screenshot: runs'");
  });
  it('includes the click for a tab page and the goto for the url', () => {
    expect(src).toContain('nav.tabs button[data-go=\\"runs\\"]');
    expect(src).toContain('await page.goto("http://localhost:7766/")');
    expect(src).toContain("toHaveScreenshot('runs.png'");
  });
});

describe('design.designLoop (injected capture + ask — no browser, no model)', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const HTML = '<html><head><style>\n.card { color: red; }\n</style></head><body><div class="card">x</div></body></html>';

  /** Fake capture: pretend each page was shot; no browser, no png on disk. */
  const fakeCapture = async (_url: string, pages: DesignPage[], outDir: string, round: number) =>
    pages.map((p) => ({ name: p.name, path: join(outDir, `r${round}-${p.name}.png`) }));

  function setup(html = HTML): { target: string; base: Parameters<typeof designLoop>[0] } {
    dir = mkdtempSync(join(tmpdir(), 'pv-design-'));
    const target = join(dir, 'index.html');
    writeFileSync(target, html);
    return {
      target,
      base: {
        url: 'http://localhost:1/',
        targetFile: target,
        pages: [{ name: 'home' }, { name: 'about' }],
        goal: 'clean dashboard',
        outDir: join(dir, 'shots'),
        rounds: 3,
        capture: fakeCapture,
        ask: async () => 'OK',
      },
    };
  }

  it('stops after round 1 when the judge says OK on every page (no edit)', async () => {
    const { target, base } = setup();
    const res = await designLoop(base);
    expect(res.rounds).toEqual([{ round: 1, findings: [
      { name: 'home', text: 'OK' },
      { name: 'about', text: 'OK' },
    ], edited: false }]);
    expect(res.shots).toHaveLength(2); // one round only
    expect(readFileSync(target, 'utf8')).toBe(HTML); // target untouched
  });

  it('stops (unedited) when there are findings but the target has no <style> block', async () => {
    const { target, base } = setup('<html><body>no styles here</body></html>');
    const logs: string[] = [];
    const res = await designLoop({ ...base, ask: async () => '- add contrast', log: (l) => logs.push(l) });
    expect(res.rounds).toHaveLength(1);
    expect(res.rounds[0].edited).toBe(false);
    expect(logs.some((l) => l.includes('no <style>'))).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('no styles here');
  });

  it('stops (unedited) when the rewrite reply has no fenced code block', async () => {
    const { target, base } = setup();
    const res = await designLoop({
      ...base,
      // judge calls carry GOAL:, the rewrite call carries FINDINGS:
      ask: async (_img, _sys, user) => (user.startsWith('FINDINGS:') ? 'sorry, no css from me' : '- fix spacing'),
    });
    expect(res.rounds).toHaveLength(1);
    expect(res.rounds[0].edited).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe(HTML);
  });

  it('a rewrite round splices the fenced CSS into the target, then OK stops round 2', async () => {
    const { target, base } = setup();
    let round = 0;
    const res = await designLoop({
      ...base,
      specFile: join(dir, 'shots.spec.ts'),
      ask: async (_img, _sys, user) => {
        if (user.startsWith('FINDINGS:')) {
          expect(user).toContain('.card { color: red; }'); // current css is shown to the model
          return 'here you go\n```css\n.card { color: blue; }\n```\n';
        }
        round++;
        return round <= 2 ? '- low contrast on the card' : 'OK'; // round 1: 2 pages bad; round 2: OK
      },
    });
    expect(res.rounds.map((r) => r.edited)).toEqual([true, false]);
    const html = readFileSync(target, 'utf8');
    expect(html).toContain('.card { color: blue; }');
    expect(html).not.toContain('color: red');
    expect(html).toContain('<div class="card">x</div>'); // markup untouched
    expect(res.shots).toHaveLength(4); // 2 pages x 2 rounds
    expect(existsSync(join(dir, 'shots.spec.ts'))).toBe(true); // spec artifact emitted
  });
});

describe('vision.usesOpenAiVision', () => {
  it('routes non-claude models (or an explicit base) to the ollama path', () => {
    expect(usesOpenAiVision('minimax-m3', undefined)).toBe(true);
    expect(usesOpenAiVision('claude-sonnet-4-6', 'https://ollama.com/v1')).toBe(true); // base forces it
    expect(usesOpenAiVision('claude-sonnet-4-6', undefined)).toBe(false);
  });
});

describe('cssSelectors + the selector-preservation gate', () => {
  it('extracts selector heads, splitting comma groups, skipping keyframe frames', () => {
    const css = `.a { color:red } .b:hover, #c { x:1 }\n@keyframes spin { 0% {opacity:0} 100% {opacity:1} }\n@media (max-width:600px) { .d { y:2 } }`;
    const s = cssSelectors(css);
    expect(s.has('.a')).toBe(true);
    expect(s.has('.b:hover')).toBe(true);
    expect(s.has('#c')).toBe(true);
    expect(s.has('.d')).toBe(true); // media inner selectors ARE contract
    expect(s.has('0%')).toBe(false); // keyframe frames are not
  });

  it('reverts a rewrite that drops selectors; applies one that keeps them all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-design-gate-'));
    const target = join(dir, 'style.css');
    writeFileSync(target, '.keep { a:1 }\n.also { b:2 }\n');
    const logs: string[] = [];
    const mkOpts = (reply: string): DesignOpts => ({
      url: 'http://x', targetFile: target, outDir: join(dir, 'shots'), goal: 'g',
      pages: [{ name: 'p' }], rounds: 1, log: (l) => logs.push(l),
      capture: async (_u, pages, out, round) => pages.map((p) => ({ name: p.name, path: join(out, `r${round}-${p.name}.png`) })),
      ask: async (_i, system) => (system.includes('senior product designer') ? '- finding' : reply),
    });

    // Dropping .also → reverted.
    await designLoop(mkOpts('```css\n.keep { a:9 }\n```'));
    expect(readFileSync(target, 'utf8')).toContain('.also'); // untouched
    expect(logs.join('\n')).toContain('DROPPED 1 selector(s)');

    // Keeping both (new props + new rule) → applied.
    await designLoop(mkOpts('```css\n.keep { a:9 }\n.also { b:3 }\n.new { c:1 }\n```'));
    expect(readFileSync(target, 'utf8')).toContain('.new');
    rmSync(dir, { recursive: true, force: true });
  });
});
