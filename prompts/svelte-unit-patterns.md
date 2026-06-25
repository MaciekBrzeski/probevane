# Unit patterns — vitest + @testing-library/svelte

## PATTERN S1 — pure function
```ts
import { it, expect } from 'vitest';
import { clamp } from './counter';
it('clamps', () => { expect(clamp(11, 0, 10)).toBe(10); });
```

## PATTERN S2 — component render + interaction
```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import Counter from './Counter.svelte';
it('increments', async () => {
  render(Counter, { props: { start: 0, max: 5 } });
  expect(screen.getByLabelText('count').textContent).toBe('0');
  await fireEvent.click(screen.getByLabelText('increment'));
  expect(screen.getByLabelText('count').textContent).toBe('1');
});
```

## Rules
- Pass props via `render(Component, { props })`.
- `await fireEvent.*` before asserting (the DOM updates async). Prefer `getByLabelText`/`getByRole`.
- Test each `export let` prop's effect and each branch.
- Import only the props/labels in the ground truth.
