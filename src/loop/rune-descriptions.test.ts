import { describe, it, expect } from 'vitest';
import { profile, type ProfileName, type ProfileOpts } from './profiles.js';
import { RUNE_DESCRIPTIONS, HOOK_DESCRIPTIONS, describeRune } from './rune-descriptions.js';

// Completeness invariant: every rune any profile can assemble must have curated
// copy, describeRune must be total + safe, and every hook must be explained.
// This is the drift guard — a new rune shipped without a description fails here.

const PROFILES: ProfileName[] = ['write_tests', 'feature', 'refactor', 'repair', 'fix', 'migrate', 'document', 'bare'];
const ALL_ON: ProfileOpts = {
  kind: 'e2e',
  quality: true,
  mutation: true,
  flakeGuard: true,
  assertMin: 80,
  a11y: true,
  visual: true,
  mfe: true,
};

function everyRuneName(): Set<string> {
  const names = new Set<string>();
  for (const p of PROFILES) for (const r of profile(p, ALL_ON)) names.add(r.name);
  return names;
}

describe('rune-descriptions completeness', () => {
  it('every rune used by any profile pipeline has non-empty summary + detail', () => {
    for (const name of everyRuneName()) {
      const d = RUNE_DESCRIPTIONS[name];
      expect(d, `${name} has no description`).toBeDefined();
      expect(d.summary.trim().length, `${name} empty summary`).toBeGreaterThan(0);
      expect(d.detail.trim().length, `${name} empty detail`).toBeGreaterThan(0);
    }
  });

  it('describeRune is total and never throws (returns the queried name)', () => {
    for (const name of Object.keys(RUNE_DESCRIPTIONS)) {
      expect(() => describeRune(name)).not.toThrow();
      const r = describeRune(name);
      expect(r.name).toBe(name);
      expect(r.summary.length).toBeGreaterThan(0);
    }
  });

  it('describeRune surfaces a live injected rule when the rune provides one', () => {
    const fakeRune = { name: 'x', systemPromptAddition: () => 'RULE TEXT' };
    expect(describeRune('x', fakeRune).rule).toBe('RULE TEXT');
    // a rune whose systemPromptAddition throws yields no rule, not an error
    const throwing = { name: 'y', systemPromptAddition: () => { throw new Error('needs ctx'); } };
    expect(describeRune('y', throwing).rule).toBeUndefined();
    // an unknown rune with no rune object still resolves
    expect(describeRune('unknown_rune').rule).toBeUndefined();
  });

  it('every loop hook has an explanation', () => {
    for (const hook of [
      'systemPromptAddition',
      'prepare',
      'onTurnStart',
      'beforeToolCall',
      'afterToolCall',
      'shouldStop',
      'onStop',
    ]) {
      expect((HOOK_DESCRIPTIONS[hook] ?? '').length, `${hook} unexplained`).toBeGreaterThan(0);
    }
  });
});
