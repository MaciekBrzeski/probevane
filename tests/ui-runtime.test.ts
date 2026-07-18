import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyProp, setPropOrAttr, Fragment } from '../src/ui/runtime.js';

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

  it('on-prefixed key with a NON-function value is not a listener (guards the &&)', () => {
    const { el, attrs, listeners } = fakeEl();
    applyProp(el, 'online', 'yes'); // starts with "on" but the value is not a function
    expect(listeners).toHaveLength(0); // an || here would wrongly addEventListener
    expect(attrs.online).toBe('yes'); // falls through to setAttribute
  });

  it('a function value on a non-on* key is not a listener (guards the &&)', () => {
    const { el, listeners } = fakeEl();
    applyProp(el, 'title', () => {}); // a function, but the key is not on*
    expect(listeners).toHaveLength(0); // an || here would wrongly addEventListener
  });

  it('class / className → className string', () => {
    const { el } = fakeEl();
    applyProp(el, 'class', 'a b');
    expect(el.className).toBe('a b');
  });

  it('dataset object → MERGED onto existing node.dataset (not replaced)', () => {
    const { el } = fakeEl();
    el.dataset.keep = '1'; // a pre-existing data-* attr
    applyProp(el, 'dataset', { go: 'chat' });
    // Object.assign merges; a dataset-branch miss would fall through to a property
    // set that REPLACES dataset, dropping `keep`.
    expect(el.dataset).toEqual({ keep: '1', go: 'chat' });
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

// Fragment → append() flattens children and skips only null/undefined/false; a
// minimal document stub lets us assert that VALID children survive (a flipped
// === in the skip guard would drop them).
describe('runtime.Fragment — child append/skip', () => {
  const origDoc = (globalThis as any).document;
  beforeAll(() => {
    (globalThis as any).document = {
      createDocumentFragment: () => {
        const kids: unknown[] = [];
        return { kids, appendChild: (n: unknown) => { kids.push(n); return n; } };
      },
      createTextNode: (s: string) => ({ text: s }),
    };
  });
  afterAll(() => { (globalThis as any).document = origDoc; });

  it('keeps valid children (text + node), drops null/undefined/false, flattens arrays', () => {
    const node = { tag: 'x' };
    const frag = Fragment({ children: ['a', null, false, undefined, [node, 'b']] }) as unknown as { kids: unknown[] };
    expect(frag.kids).toEqual([{ text: 'a' }, node, { text: 'b' }]);
  });
});
