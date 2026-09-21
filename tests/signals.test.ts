// Signals core (src/ui/signals.ts) — node-testable reactive engine. The DOM
// half (h bindings, eachInto, when) is browser-only and exercised by the
// e2e-dash suite once adopted; these tests pin the state machinery: tracking,
// batching, memoization, cleanup ordering, dynamic deps, disposal scopes.
import { describe, expect, it } from 'vitest';
import { computed, effect, flushSync, runInScope, signal } from '../src/ui/signals.ts';

describe('signal + effect', () => {
  it('tracks reads and re-runs on set', () => {
    const s = signal(1);
    const seen: number[] = [];
    effect(() => { seen.push(s.get()); });
    s.set(2); flushSync();
    s.set(3); flushSync();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('same-value set is a no-op (Object.is)', () => {
    const s = signal(1);
    let runs = 0;
    effect(() => { s.get(); runs++; });
    s.set(1); flushSync();
    expect(runs).toBe(1);
  });

  it('batches: N sets before flush -> one re-run', () => {
    const a = signal(1), b = signal(2);
    let runs = 0;
    effect(() => { a.get(); b.get(); runs++; });
    a.set(10); b.set(20); a.set(11); flushSync();
    expect(runs).toBe(2); // initial + one batched re-run
  });

  it('dispose stops tracking', () => {
    const s = signal(1);
    let runs = 0;
    const e = effect(() => { s.get(); runs++; });
    e.dispose();
    s.set(2); flushSync();
    expect(runs).toBe(1);
  });

  it('cleanup runs before each re-run and on dispose', () => {
    const s = signal(1);
    const log: string[] = [];
    const e = effect(() => { const v = s.get(); log.push(`run${v}`); return () => log.push(`clean${v}`); });
    s.set(2); flushSync();
    e.dispose();
    expect(log).toEqual(['run1', 'clean1', 'run2', 'clean2']);
  });

  it('dynamic deps: the branch not read stops triggering', () => {
    const cond = signal(true), a = signal('a'), b = signal('b');
    let runs = 0;
    effect(() => { runs++; if (cond.get()) a.get(); else b.get(); });
    cond.set(false); flushSync(); // now reads b only
    a.set('a2'); flushSync();     // must NOT re-run
    expect(runs).toBe(2);
    b.set('b2'); flushSync();
    expect(runs).toBe(3);
  });
});

describe('computed', () => {
  it('derives and propagates', () => {
    const s = signal(2);
    const dbl = computed(() => s.get() * 2);
    let last = 0;
    effect(() => { last = dbl(); });
    s.set(5); flushSync();
    expect(last).toBe(10);
  });

  it('memoizes: downstream re-runs only when the RESULT changes', () => {
    const n = signal(1);
    const parity = computed(() => n.get() % 2);
    let runs = 0;
    effect(() => { parity(); runs++; });
    n.set(3); flushSync(); // parity still 1
    expect(runs).toBe(1);
    n.set(4); flushSync(); // parity flips to 0
    expect(runs).toBe(2);
  });
});

describe('runInScope', () => {
  it('disposes every effect created inside the scope together', () => {
    const s = signal(0);
    let inner = 0, outer = 0;
    effect(() => { s.get(); outer++; });
    const scope = runInScope(() => {
      effect(() => { s.get(); inner++; });
      effect(() => { s.get(); inner++; });
      return null;
    });
    s.set(1); flushSync();
    expect(inner).toBe(4);
    scope.dispose();
    s.set(2); flushSync();
    expect(inner).toBe(4); // scoped effects dead
    expect(outer).toBe(3); // unscoped effect still live
  });

  it('nested scopes: inner effects belong to the inner scope only', () => {
    const s = signal(0);
    let innerRuns = 0, outerRuns = 0;
    const outerScope = runInScope(() => {
      effect(() => { s.get(); outerRuns++; });
      const innerScope = runInScope(() => {
        effect(() => { s.get(); innerRuns++; });
        return null;
      });
      innerScope.dispose();
      return null;
    });
    s.set(1); flushSync();
    expect(innerRuns).toBe(1); // disposed before the set
    expect(outerRuns).toBe(2);
    outerScope.dispose();
    s.set(2); flushSync();
    expect(outerRuns).toBe(2);
  });
});
