import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, addTodo, remaining } from './App.js';

// One hand-written, passing test. This is the P0 seed proving the run pipeline
// is green. Generated tests in later phases extend coverage beyond this.
describe('App', () => {
  it('adds a todo and updates the remaining count', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByLabelText('remaining count')).toHaveTextContent('0 remaining');

    await user.type(screen.getByLabelText('New todo'), 'write tests');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('write tests')).toBeInTheDocument();
    expect(screen.getByLabelText('remaining count')).toHaveTextContent('1 remaining');
  });
});

describe('addTodo (pure)', () => {
  it('appends a trimmed todo with the next id', () => {
    const after = addTodo([], '  buy milk  ');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: 1, text: 'buy milk', done: false });
    expect(remaining(after)).toBe(1);
  });
});
