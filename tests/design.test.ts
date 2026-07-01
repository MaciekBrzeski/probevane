import { describe, it, expect } from 'vitest';
import { extractStyle, spliceStyle, specSource } from '../src/visual/design.js';
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

describe('vision.usesOpenAiVision', () => {
  it('routes non-claude models (or an explicit base) to the ollama path', () => {
    expect(usesOpenAiVision('minimax-m3', undefined)).toBe(true);
    expect(usesOpenAiVision('claude-sonnet-4-6', 'https://ollama.com/v1')).toBe(true); // base forces it
    expect(usesOpenAiVision('claude-sonnet-4-6', undefined)).toBe(false);
  });
});
