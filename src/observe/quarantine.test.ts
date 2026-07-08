import { describe, it, expect } from 'vitest';
import { isTransientStop } from './quarantine.js';

// The supervisor uses this to decide park vs retry — deterministic give-ups must
// NOT be retried (they can't change on an identical re-run); crashes should.
describe('isTransientStop', () => {
  it('treats a crash/error (and the unknown/missing reason) as transient', () => {
    expect(isTransientStop('error')).toBe(true);
    expect(isTransientStop(undefined)).toBe(true);
  });
  it('treats deterministic give-ups as NOT transient (park them)', () => {
    for (const r of ['difficulty', 'max_steps', 'stuck', 'budget', 'accepted']) expect(isTransientStop(r)).toBe(false);
  });
});
