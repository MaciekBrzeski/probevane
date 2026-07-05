import { describe, it, expect } from 'vitest';
import { renderGallery, WIDGETS } from '../src/gallery';

describe('gallery', () => {
  const html = renderGallery();

  it('is a standalone HTML component catalog', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('component library');
  });

  it('renders every component with both backends + a usage snippet', () => {
    for (const wg of WIDGETS) {
      const card = html.split(`data-widget="${wg.name}"`)[1]!.split('data-widget="')[0]!;
      expect(card, wg.name).toContain('<svg viewBox');
      expect(card, wg.name).toContain('class="cells"');
      expect(card, wg.name).toContain('class="usage"');
    }
  });

  it('the gauge value + node labels render (SVG side is contiguous text)', () => {
    expect(html).toContain('>71%</text>'); // gauge % in the SVG backend
    expect(html).toContain('>args</text>'); // a node label in the SVG backend
    // the cell backend splits glyphs into per-char spans → assert the % span exists
    expect(html).toMatch(/<span[^>]*>%<\/span>/);
  });
});
