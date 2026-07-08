import { describe, it, expect } from 'vitest';
import { classifyPath, classifyPrompt, resolveSpec } from './classify.js';

describe('classifyPath', () => {
  it('routes test intent to write_tests with high confidence', () => {
    expect(classifyPath('write unit tests for the parser').path).toBe('write_tests');
  });
  it('routes refactor / fix / vague prompts', () => {
    expect(classifyPath('refactor the auth module').path).toBe('refactor');
    expect(classifyPath('fix the null bug').path).toBe('fix');
    const vague = classifyPath('do something with the code');
    expect(vague.path).toBe('write_tests'); // home-turf fallback
    expect(vague.confidence).toBeLessThan(0.7);
  });
  it('drops confidence when several categories match', () => {
    // "add tests" hits both write_tests and feature ("add") → ambiguous.
    const c = classifyPath('add tests');
    expect(c.path).toBe('write_tests'); // priority order: test beats add
    expect(c.confidence).toBeLessThan(0.9);
  });
});

describe('classifyPrompt', () => {
  it('detects e2e kind and a named file scope', () => {
    const c = classifyPrompt('add e2e tests for src/checkout.ts');
    expect(c.draft.kind).toBe('e2e');
    expect(c.draft.only).toBe('src/checkout.ts');
    expect(c.draft.decompose).toEqual({ perFile: false });
  });
  it('always asks the ship question; asks scope only when no file is named', () => {
    const withFile = classifyPrompt('test src/a.ts');
    expect(withFile.questions.some((q) => q.field === 'ship')).toBe(true);
    expect(withFile.questions.some((q) => q.field === 'scope')).toBe(false);
    const noFile = classifyPrompt('add tests to the repo');
    expect(noFile.questions.some((q) => q.field === 'scope')).toBe(true);
  });
  it('asks the path question when confidence is low', () => {
    expect(classifyPrompt('do something vague').questions.some((q) => q.field === 'path')).toBe(true);
  });
});

describe('resolveSpec', () => {
  const base = { id: 'i1', dir: '/repo', prompt: 'add tests' };

  it('fills defaults + write_tests acceptance floors', () => {
    const { draft } = classifyPrompt('add tests');
    const s = resolveSpec(base, draft, { scope: 'repo', ship: 'no' });
    expect(s.budget).toBe(40000);
    expect(s.maxSteps).toBe(30);
    expect(s.kind).toBe('unit');
    expect(s.acceptance).toEqual({ minTests: 3, minCoverage: 80 });
    expect(s.decompose).toEqual({ perFile: true });
    expect(s.ship).toBe(false);
    expect(s.worktree).toBe(false);
  });

  it('applies scope=one (no per-file decompose) and ship=yes', () => {
    const { draft } = classifyPrompt('add tests');
    const s = resolveSpec(base, draft, { scope: 'one', ship: 'yes' });
    expect(s.decompose).toEqual({ perFile: false });
    expect(s.ship).toBe(true);
  });

  it('lets an answer override the inferred path', () => {
    const { draft } = classifyPrompt('add tests');
    expect(resolveSpec(base, draft, { path: 'feature' }).path).toBe('feature');
  });

  it('carries an explicit takeover through (bare ollama needs a real rescue tier)', () => {
    const { draft } = classifyPrompt('add tests');
    const s = resolveSpec({ ...base, model: 'ollama', takeover: 'sonnet' }, draft, {});
    expect(s.model).toBe('ollama');
    expect(s.takeover).toBe('sonnet');
  });
});
