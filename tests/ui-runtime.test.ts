import { describe, it, expect } from 'vitest';
import { applyProp, setPropOrAttr } from '../src/ui/runtime.js';

// runtime.ts's h() needs a real DOM, but applyProp/setPropOrAttr only touch a
// node's addEventListener / className / dataset / setAttribute / property set — all
// mockable with a fake element, so the prop-dispatch logic is testable in node.
function fakeEl() {
  const attrs: Record<string, string> = {};
  const listeners: [string, unknown][] = [];
  const el = {
    className: '',
    dataset: {} as Record<string, string>,
    addEventListener: (ev: string, fn: unknown) => listeners.push([ev, fn]),
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
  } as unknown as HTMLElement;
  return { el, attrs, listeners };
}

describe('runtime.applyProp — prop dispatch', () => {
  it('null / undefined / false props are skipped', () => {
    const { el, attrs, listeners } = fakeEl();
    for (const v of [null, undefined, false]) applyProp(el, 'title', v);
    expect(Object.keys(attrs)).toHaveLength(0);
    expect(listeners).toHaveLength(0);
  });

  it('on* function → addEventListener with the lowercased event name', () => {
    const { el, listeners } = fakeEl();
    const fn = () => {};
    applyProp(el, 'onClick', fn);
    expect(listeners).toEqual([['click', fn]]);
  });

  it('class / className → className string', () => {
    const { el } = fakeEl();
    applyProp(el, 'class', 'a b');
    expect(el.className).toBe('a b');
  });

  it('dataset object → merged onto node.dataset', () => {
    const { el } = fakeEl();
    applyProp(el, 'dataset', { wired: '1', go: 'chat' });
    expect(el.dataset).toEqual({ wired: '1', go: 'chat' });
  });

  it('known writable property → assigned as a property (not an attribute)', () => {
    const { el, attrs } = fakeEl();
    (el as unknown as Record<string, unknown>).value = '';
    applyProp(el, 'value', 'hi');
    expect((el as unknown as Record<string, unknown>).value).toBe('hi');
    expect(attrs.value).toBeUndefined();
  });

  it('read-only reflected prop (getter-only) falls back to setAttribute', () => {
    const { el, attrs } = fakeEl();
    Object.defineProperty(el, 'list', { get: () => '', configurable: true }); // read-only, like <input>.list
    applyProp(el, 'list', 'chat-dirs');
    expect(attrs.list).toBe('chat-dirs');
  });

  it('unknown key → setAttribute', () => {
    const { el, attrs } = fakeEl();
    setPropOrAttr(el, 'data-x', 'y');
    expect(attrs['data-x']).toBe('y');
  });
});
