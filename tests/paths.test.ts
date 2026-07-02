import { describe, it, expect } from 'vitest';
import { profile } from '../src/loop/profiles.js';

const names = (runes: { name: string }[]) => runes.map((r) => r.name);

describe('migrate profile', () => {
  it('is behavior-locked (tests are the contract), no acceptance/red gates', () => {
    const ns = names(profile('migrate', { kind: 'unit' }));
    expect(ns).toContain('behavior_lock');
    expect(ns).toContain('plan_first');
    expect(ns).not.toContain('acceptance_gate');
    expect(ns).not.toContain('red_first');
  });
  it('honors opt-in quality + mfe gates', () => {
    const ns = names(profile('migrate', { kind: 'unit', quality: true, mfe: true }));
    expect(ns).toContain('quality_gate');
    expect(ns).toContain('mfe_gate');
  });
});

describe('document profile', () => {
  it('is behavior-locked and minimal (docs only, no test/acceptance gates)', () => {
    const ns = names(profile('document', { kind: 'unit' }));
    expect(ns).toEqual(['context_inject', 'path_guard', 'plan_first', 'behavior_lock', 'session_diary', 'caveat_harvest']);
  });
});
