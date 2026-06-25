import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Counter from './Counter.vue';
import App from './App.vue';
import { increment, clamp, isEven } from './counter';

// Golden hand-written suite — the baseline a good generated run should match.
describe('counter (pure)', () => {
  it('increments by step', () => {
    expect(increment(1)).toBe(2);
    expect(increment(1, 5)).toBe(6);
  });
  it('clamps to range', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('detects parity', () => {
    expect(isEven(4)).toBe(true);
    expect(isEven(3)).toBe(false);
  });
});

describe('Counter.vue', () => {
  it('increments on click and tracks parity', async () => {
    const w = mount(Counter, { props: { start: 0, max: 5 } });
    expect(w.get('[aria-label="count"]').text()).toBe('0');
    expect(w.get('[aria-label="parity"]').text()).toBe('even');
    await w.get('[aria-label="increment"]').trigger('click');
    expect(w.get('[aria-label="count"]').text()).toBe('1');
    expect(w.get('[aria-label="parity"]').text()).toBe('odd');
  });

  it('does not exceed max', async () => {
    const w = mount(Counter, { props: { start: 5, max: 5 } });
    await w.get('[aria-label="increment"]').trigger('click');
    expect(w.get('[aria-label="count"]').text()).toBe('5');
  });

  it('resets to the start value', async () => {
    const w = mount(Counter, { props: { start: 2, max: 9 } });
    await w.get('[aria-label="increment"]').trigger('click');
    expect(w.get('[aria-label="count"]').text()).toBe('3');
    await w.get('[aria-label="reset"]').trigger('click');
    expect(w.get('[aria-label="count"]').text()).toBe('2');
  });
});

describe('App.vue', () => {
  it('renders the title and a counter', () => {
    const w = mount(App);
    expect(w.get('h1').text()).toBe('Vue Counter');
    expect(w.get('[aria-label="count"]').text()).toBe('0');
  });
});
