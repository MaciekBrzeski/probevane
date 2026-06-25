import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Counter from './Counter.svelte';
import { increment, clamp, isEven } from './counter';

describe('counter (pure)', () => {
  it('increments', () => { expect(increment(1)).toBe(2); expect(increment(1, 4)).toBe(5); });
  it('clamps', () => { expect(clamp(11, 0, 10)).toBe(10); expect(clamp(-1, 0, 10)).toBe(0); });
  it('parity', () => { expect(isEven(4)).toBe(true); expect(isEven(3)).toBe(false); });
});

describe('Counter.svelte', () => {
  it('increments on click and flips parity', async () => {
    render(Counter, { props: { start: 0, max: 5 } });
    expect(screen.getByLabelText('count').textContent).toBe('0');
    expect(screen.getByLabelText('parity').textContent).toBe('even');
    await fireEvent.click(screen.getByLabelText('increment'));
    expect(screen.getByLabelText('count').textContent).toBe('1');
    expect(screen.getByLabelText('parity').textContent).toBe('odd');
  });
  it('does not exceed max', async () => {
    render(Counter, { props: { start: 5, max: 5 } });
    await fireEvent.click(screen.getByLabelText('increment'));
    expect(screen.getByLabelText('count').textContent).toBe('5');
  });
  it('resets', async () => {
    render(Counter, { props: { start: 2, max: 9 } });
    await fireEvent.click(screen.getByLabelText('increment'));
    await fireEvent.click(screen.getByLabelText('reset'));
    expect(screen.getByLabelText('count').textContent).toBe('2');
  });
});
