import { describe, it, expect } from 'vitest';
import { profileSegments, profile, type ProfileName, type ProfileOpts } from '../src/loop/profiles.js';
import { describePipeline } from '../src/loop/describe.js';

// Pins every profile's pipeline SEMANTICS across the vane codegen swap: the
// segment/rune shapes below were captured from the hand-written builders and
// must stay identical when profiles.gen.ts (generated from vane/profiles.vane)
// takes over. A diff here = the codegen changed behavior, not just source form.

/** Rune ids per segment — the comparable shape (rune fns aren't comparable). */
function shape(name: ProfileName, opts: ProfileOpts): string[] {
  return profileSegments(name, opts).map((s) => `${s.sub}:${s.runes.map((r) => r.name).join(',')}`);
}

const BASE: ProfileOpts = { kind: 'unit' };
const LOADED: ProfileOpts = {
  kind: 'e2e', minTests: 5, minCoverage: 80, shellChecks: ['build'],
  mutation: true, flakeGuard: true, flakeTolerance: 1, assertMin: 70,
  a11y: true, visual: true, quality: true, mfe: true,
};

describe('profile pipelines — semantics pinned across the codegen swap', () => {
  it('write_tests: base and fully-loaded opts', () => {
    expect(shape('write_tests', BASE)).toEqual([
      'preamble:context_inject,path_guard,plan_first,no_regression',
      'green-gates:validation_gate,audit_gate,hermetic_gate,acceptance_gate,oracle_gate',
      'opt-in:',
      'harvest:session_diary,caveat_harvest,distill_trace,library_promote',
    ]);
    expect(shape('write_tests', LOADED)).toEqual([
      'preamble:context_inject,path_guard,plan_first,no_regression',
      'green-gates:validation_gate,audit_gate,hermetic_gate,acceptance_gate,oracle_gate',
      'opt-in:flake_gate,assertion_gate,mutation_gate,a11y_gate,visual_gate,quality_gate',
      'harvest:session_diary,caveat_harvest,distill_trace,library_promote',
    ]);
  });

  it('feature / repair / fix', () => {
    expect(shape('feature', BASE)).toEqual([
      'preamble:context_inject,path_guard,red_first,plan_first,no_regression',
      'green-gates:validation_gate,audit_gate,hermetic_gate,acceptance_gate,oracle_gate',
      'opt-in:',
      'harvest:session_diary,caveat_harvest,distill_trace,library_promote',
    ]);
    expect(shape('repair', { ...BASE, mfe: true, quality: true })).toEqual([
      'preamble:context_inject,path_guard,plan_first',
      'green-gates:validation_gate,audit_gate,hermetic_gate,oracle_gate',
      'opt-in:quality_gate,mfe_gate',
      'harvest:session_diary,caveat_harvest,distill_trace,library_promote',
    ]);
    expect(shape('fix', BASE)).toEqual(shape('repair', BASE)); // alias
  });

  it('refactor / migrate / document / visual / bare', () => {
    expect(shape('refactor', BASE)).toEqual([
      'preamble:context_inject,path_guard,plan_first',
      'safety-net:behavior_lock',
      'opt-in:',
      'harvest:session_diary,caveat_harvest',
    ]);
    expect(shape('migrate', BASE)).toEqual(shape('refactor', BASE)); // alias
    expect(shape('document', BASE)).toEqual([
      'preamble:context_inject,path_guard,plan_first',
      'safety-net:behavior_lock',
      'harvest:session_diary,caveat_harvest',
    ]);
    expect(shape('visual', BASE)).toEqual([
      'preamble:context_inject,path_guard,plan_first',
      'safety-net:behavior_lock',
      'harvest:session_diary,caveat_harvest',
    ]);
    expect(shape('visual', { ...BASE, render: { url: 'http://x', goal: 'g' } })).toEqual([
      'preamble:context_inject,path_guard,plan_first',
      'safety-net:behavior_lock',
      'green-gates:render_gate',
      'harvest:session_diary,caveat_harvest',
    ]);
    expect(shape('bare', BASE)).toEqual([]);
  });

  it('profile() = segments flattened; describePipeline agrees', () => {
    const runes = profile('refactor', BASE);
    expect(runes.map((r) => r.name)).toEqual([
      'context_inject', 'path_guard', 'plan_first', 'behavior_lock', 'session_diary', 'caveat_harvest',
    ]);
    const d = describePipeline('refactor', BASE);
    expect(d.runes.map((r) => r.name)).toEqual(runes.map((r) => r.name));
  });
});
