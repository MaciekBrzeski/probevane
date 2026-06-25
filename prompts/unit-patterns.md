# Unit patterns — vitest + @testing-library/react

## PATTERN U1 — pure function (table-driven)
For exported helpers with no DOM. Cover: happy path, edge cases (empty, boundary), and immutability if it returns new data.
```ts
import { describe, it, expect } from 'vitest';
import { addTodo } from './App';

describe('addTodo', () => {
  it.each([
    ['appends with next id', [], 'a', 1],
    ['trims whitespace', [], '  a  ', 1],
  ])('%s', (_name, list, text, len) => {
    expect(addTodo(list as any, text as string)).toHaveLength(len as number);
  });

  it('does not mutate the input', () => {
    const list = [{ id: 1, text: 'x', done: false }];
    const snapshot = structuredClone(list);
    addTodo(list, 'y');
    expect(list).toEqual(snapshot);
  });
});
```

## PATTERN U2 — component render + interaction
Render, act as a user, assert on user-visible output. Use roles/labels, not test ids, when a role exists.
```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

it('adds a todo and updates the remaining count', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText('New todo'), 'write tests');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByText('write tests')).toBeInTheDocument();
  expect(screen.getByLabelText('remaining count')).toHaveTextContent('1 remaining');
});
```

## PATTERN U3 — conditional / branch behavior
Drive each branch explicitly (e.g. toggle done → strike-through, empty input → no add). One behavior per test, named for the behavior.

## PATTERN U4 — mocking a dependency
Mock modules with `vi.mock`; restore with `vi.restoreAllMocks()` in an `afterEach`. Never let a unit test hit the network or real timers (`vi.useFakeTimers()`).

## Notes
- Import only symbols the ground truth lists.
- Prefer `getByRole`/`getByLabelText`; use `findBy*` for async appearance; avoid `getByTestId` when a role exists.
- Keep assertions specific (`toHaveTextContent('1 remaining')`, not `toBeTruthy()`).
