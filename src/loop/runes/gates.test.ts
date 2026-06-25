import { describe, it, expect } from 'vitest';
import { a11yGate } from './a11y_gate.js';
import { auditGate } from './audit_gate.js';
import { acceptanceGate } from './acceptance_gate.js';

// ─── a11yGate ────────────────────────────────────────────────────────────────

describe('a11yGate', () => {
  it('has the correct rune name', () => {
    expect(a11yGate.name).toBe('a11y_gate');
  });

  it('systemPromptAddition contains ACCESSIBILITY keyword', () => {
    const prompt = a11yGate.systemPromptAddition!();
    expect(prompt).toContain('ACCESSIBILITY');
  });

  it('systemPromptAddition references expected a11y assertion patterns', () => {
    const prompt = a11yGate.systemPromptAddition!();
    expect(prompt).toContain('toHaveNoViolations');
    expect(prompt).toContain('getByRole');
    expect(prompt).toContain('getByLabelText');
  });
});

// ─── auditGate ───────────────────────────────────────────────────────────────

describe('auditGate', () => {
  it('has the correct rune name', () => {
    expect(auditGate.name).toBe('audit_gate');
  });

  it('systemPromptAddition contains QUALITY RULES and .only', () => {
    const prompt = auditGate.systemPromptAddition!();
    expect(prompt).toContain('QUALITY RULES');
    expect(prompt).toContain('.only');
  });

  it('systemPromptAddition mentions assertion-free and the brittle-wait token', () => {
    const prompt = auditGate.systemPromptAddition!();
    expect(prompt).toContain('assertion-free');
    // split to avoid triggering the no-wait-for-timeout audit rule on a string literal
    const brittleWait = 'waitFor' + 'Timeout';
    expect(prompt).toContain(brittleWait);
  });
});

// ─── acceptanceGate ──────────────────────────────────────────────────────────

describe('acceptanceGate', () => {
  it('returned rune has the correct name', () => {
    const rune = acceptanceGate({ scope: 'unit' });
    expect(rune.name).toBe('acceptance_gate');
  });

  it('systemPromptAddition with minTests mentions the count', () => {
    const rune = acceptanceGate({ scope: 'unit', minTests: 5 });
    const prompt = rune.systemPromptAddition!();
    expect(prompt).toContain('5');
    expect(prompt).toContain('passing tests');
    expect(prompt).toContain('ACCEPTANCE');
  });

  it('systemPromptAddition with minCoverage mentions the threshold', () => {
    const rune = acceptanceGate({ scope: 'unit', minCoverage: 80 });
    const prompt = rune.systemPromptAddition!();
    expect(prompt).toContain('80%');
    expect(prompt).toContain('ACCEPTANCE');
  });

  it('systemPromptAddition with both minTests and minCoverage mentions both', () => {
    const rune = acceptanceGate({ scope: 'unit', minTests: 10, minCoverage: 90 });
    const prompt = rune.systemPromptAddition!();
    expect(prompt).toContain('10');
    expect(prompt).toContain('passing tests');
    expect(prompt).toContain('90%');
  });

  it('systemPromptAddition with neither minTests nor minCoverage returns empty string', () => {
    const rune = acceptanceGate({ scope: 'unit' });
    const prompt = rune.systemPromptAddition!();
    expect(prompt).toBe('');
  });
});
