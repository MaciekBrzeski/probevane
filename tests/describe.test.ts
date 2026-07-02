import { describe, it, expect } from 'vitest';
import { describePipeline, pipelineModel, pipelineMermaid, fullModel, SUBROUTINES } from '../src/loop/describe.js';
import { profile, profileSegments, type ProfileName, type ProfileOpts } from '../src/loop/profiles.js';

describe('describePipeline', () => {
  it('feature: TDD guards before the gates, harvest last', () => {
    const { runes } = describePipeline('feature', { kind: 'unit' });
    const names = runes.map((r) => r.name);
    expect(names).toContain('red_first');
    expect(names).toContain('validation_gate');
    // red_first vetoes tools -> a guard (even though it also gates finish).
    expect(runes.find((r) => r.name === 'red_first')!.phase).toBe('guard');
    expect(runes.find((r) => r.name === 'validation_gate')!.phase).toBe('gate');
    expect(runes.find((r) => r.name === 'session_diary')!.phase).toBe('harvest');
    // guards come before gates come before harvest in dispatch order.
    const phaseRank = { context: 0, guard: 1, observer: 2, gate: 3, harvest: 4 } as const;
    const ranks = runes.map((r) => phaseRank[r.phase]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('bare profile has no runes', () => {
    expect(describePipeline('bare', { kind: 'unit' }).runes).toEqual([]);
  });

  it('a rune exposes the hooks it actually implements', () => {
    const audit = describePipeline('write_tests', { kind: 'unit' }).runes.find((r) => r.name === 'audit_gate')!;
    expect(audit.hooks).toContain('shouldStop');
  });
});

describe('pipelineModel (toggle-aware, drift-free)', () => {
  it('labels opt-in gates by the toggle that enables them; base runes are always-on', () => {
    const m = pipelineModel('write_tests');
    const by = (n: string) => m.find((r) => r.name === n);
    expect(by('quality_gate')!.requiredBy).toBe('quality');
    expect(by('mutation_gate')!.requiredBy).toBe('mutation');
    expect(by('flake_gate')!.requiredBy).toBe('flake');
    expect(by('acceptance_gate')!.requiredBy).toBeNull(); // always
    expect(by('visual_gate')!.e2eOnly).toBe(true);
  });

  it('matches the real profile() — filtering the model by enabled toggles reproduces the pipeline', () => {
    // No toggles -> only always-on runes, same set/order as profile() with no opts.
    const baseFromModel = pipelineModel('write_tests').filter((r) => r.requiredBy === null).map((r) => r.name);
    const baseFromProfile = describePipeline('write_tests', { kind: 'unit' }).runes.map((r) => r.name);
    expect(baseFromModel).toEqual(baseFromProfile);
  });

  it('fullModel covers every profile', () => {
    const names: ProfileName[] = ['write_tests', 'feature', 'refactor', 'repair', 'fix', 'migrate', 'document', 'bare'];
    const fm = fullModel();
    for (const n of names) expect(fm.profiles[n]).toBeDefined();
    expect(fm.toggles.length).toBeGreaterThan(0);
    expect(fm.phases.length).toBe(5);
  });
});

describe('subroutines (profileSegments is the single source of truth)', () => {
  const PROFILES: ProfileName[] = ['write_tests', 'feature', 'refactor', 'repair', 'fix', 'migrate', 'document', 'bare'];
  const cases: { name: ProfileName; opts: ProfileOpts }[] = [
    { name: 'write_tests', opts: { kind: 'e2e', flakeGuard: true, assertMin: 80, mutation: true, a11y: true, visual: true, quality: true, mfe: true } },
    { name: 'feature', opts: { kind: 'unit', quality: true, mfe: true } },
    { name: 'refactor', opts: { kind: 'unit', quality: true, mfe: true } },
    { name: 'repair', opts: { kind: 'unit' } },
    { name: 'fix', opts: { kind: 'unit' } },
    { name: 'document', opts: { kind: 'unit' } },
  ];

  it('profile() is exactly profileSegments() flattened (names + order)', () => {
    for (const { name, opts } of cases) {
      const flat = profileSegments(name, opts).flatMap((s) => s.runes).map((r) => r.name);
      expect(profile(name, opts).map((r) => r.name)).toEqual(flat);
    }
  });

  it('every described rune carries a known subroutine', () => {
    const ids = new Set(SUBROUTINES.map((s) => s.id));
    for (const n of PROFILES)
      for (const r of describePipeline(n, { kind: 'unit' }).runes) expect(ids.has(r.subroutine)).toBe(true);
  });

  it('write_tests carries the extras suite but NOT the mfe gate, even all-on', () => {
    const ns = profile('write_tests', { kind: 'e2e', flakeGuard: true, assertMin: 80, mutation: true, a11y: true, visual: true, quality: true, mfe: true }).map((r) => r.name);
    expect(ns).toContain('flake_gate');
    expect(ns).toContain('quality_gate');
    expect(ns).not.toContain('mfe_gate');
  });

  it('repair and fix compose identically; refactor and migrate compose identically', () => {
    const seq = (n: ProfileName) => profile(n, { kind: 'unit', quality: true, mfe: true }).map((r) => r.name);
    expect(seq('repair')).toEqual(seq('fix'));
    expect(seq('refactor')).toEqual(seq('migrate'));
  });

  it("a profile's subroutine order is a contiguous subsequence of the canonical order", () => {
    const order = SUBROUTINES.map((s) => s.id);
    for (const { name, opts } of cases) {
      const subs = profileSegments(name, opts).map((s) => s.sub);
      // each appears once, in canonical order
      const idxs = subs.map((s) => order.indexOf(s));
      expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
      expect(new Set(subs).size).toBe(subs.length);
    }
  });
});

describe('rune/group descriptions (click-to-explain)', () => {
  it('every described rune carries a non-empty summary + detail', () => {
    for (const r of describePipeline('write_tests', { kind: 'e2e', quality: true, mutation: true, flakeGuard: true, assertMin: 80, a11y: true, visual: true } as never).runes) {
      expect(r.summary.length, `${r.name} summary`).toBeGreaterThan(0);
      expect(r.detail.length, `${r.name} detail`).toBeGreaterThan(0);
    }
  });

  it('gate/guard runes expose their live injected rule; pure harvest runes do not', () => {
    const runes = describePipeline('write_tests', { kind: 'unit' }).runes;
    expect(runes.find((r) => r.name === 'hermetic_gate')!.rule).toMatch(/HERMETIC/);
    expect(runes.find((r) => r.name === 'plan_first')!.rule).toBeTruthy();
    expect(runes.find((r) => r.name === 'session_diary')!.rule).toBeUndefined();
  });

  it('fullModel carries group detail + hook descriptions for the demo', () => {
    const fm = fullModel();
    expect(fm.phases[0].detail.length).toBeGreaterThan(0);
    expect(fm.subroutines[0].detail.length).toBeGreaterThan(0);
    expect(fm.toggles[0].detail.length).toBeGreaterThan(0);
    expect(fm.hookDescriptions.shouldStop.length).toBeGreaterThan(0);
  });
});

describe('pipelineMermaid', () => {
  it('emits a phase-grouped flowchart with styled gates', () => {
    const { runes } = describePipeline('write_tests', { kind: 'unit' });
    const mm = pipelineMermaid(runes);
    expect(mm).toContain('```mermaid');
    expect(mm).toContain('flowchart TD');
    expect(mm).toContain('subgraph gate');
    expect(mm).toContain(':::gate');
    expect(mm).toContain('classDef gate');
  });

  it('uses profile() as the single source (audit_gate node present)', () => {
    void profile; // imported to assert the source-of-truth dependency exists
    expect(pipelineMermaid(describePipeline('feature', { kind: 'unit' }).runes)).toContain('audit_gate');
  });
});
