# Unit patterns — vitest + @vue/test-utils

## PATTERN V1 — pure function
```ts
import { describe, it, expect } from 'vitest';
import { clamp } from './counter';

describe('clamp', () => {
  it('bounds to range', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
});
```

## PATTERN V2 — component mount + interaction
Mount with props, query by `[aria-label]`, ALWAYS `await` trigger before asserting.
```ts
import { mount } from '@vue/test-utils';
import Counter from './Counter.vue';

it('increments on click', async () => {
  const w = mount(Counter, { props: { start: 0, max: 5 } });
  expect(w.get('[aria-label="count"]').text()).toBe('0');
  await w.get('[aria-label="increment"]').trigger('click');
  expect(w.get('[aria-label="count"]').text()).toBe('1');
});
```

## PATTERN V3 — props / boundary behavior
Drive each branch (e.g. clamp at `max`, parity flip) with explicit prop setups. One behavior per test.

## PATTERN V4 — emitted events
```ts
await w.get('[aria-label="submit"]').trigger('click');
expect(w.emitted('save')).toBeTruthy();
expect(w.emitted('save')![0]).toEqual([expectedPayload]);
```

## Rules
- Query by role/aria-label, not internal component state.
- `trigger()` returns a promise — `await` it (the `vue-await-trigger` audit rule enforces this).
- Use the project's `mount` (not shallowMount) unless isolating children.
- Import only symbols/props listed in the ground truth.
