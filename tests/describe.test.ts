import { describe, it, expect } from 'vitest';
import { describePipeline, pipelineModel, pipelineMermaid, fullModel } from '../src/loop/describe.js';
import { profile, type ProfileName } from '../src/loop/profiles.js';

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
