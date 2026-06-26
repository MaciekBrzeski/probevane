import { describe, it, expect } from 'vitest';
import { vueAuditRules } from './rules-vue';
import { jsAuditRules } from './rules-js';
import type { AuditRule } from '../adapters/adapter';

// vueAuditRules() and its rules are pure functions over strings: no network,
// clock, or randomness, so these tests are inherently hermetic.

function findRule(rules: AuditRule[], id: string): AuditRule {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`expected rule '${id}' to exist`);
  return rule;
}

// Invoke a rule's check on a single line; lineNo/file/full default sensibly.
function check(rule: AuditRule, line: string): string | null {
  return rule.check(line, 1, 'spec.test.ts', line);
}

const AWAIT_MSG =
  'trigger() not awaited \u2014 await it so the DOM updates before you assert';

describe('vueAuditRules', () => {
  it('returns the shared JS rules plus exactly one Vue-specific rule', () => {
    const rules = vueAuditRules();
    expect(rules).toHaveLength(jsAuditRules().length + 1);
  });

  it('contains every JS audit rule id', () => {
    const ids = vueAuditRules().map((r) => r.id);
    const jsIds = jsAuditRules().map((r) => r.id);
    for (const id of jsIds) {
      expect(ids).toContain(id);
    }
  });

  it('adds the vue-await-trigger rule with warn severity', () => {
    const rule = findRule(vueAuditRules(), 'vue-await-trigger');
    expect(rule.id).toBe('vue-await-trigger');
    expect(rule.severity).toBe('warn');
  });

  it('exposes well-formed rules (non-empty id, valid severity, callable check)', () => {
    const rules = vueAuditRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(typeof rule.id).toBe('string');
      expect(rule.id.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(rule.severity);
      expect(typeof rule.check).toBe('function');
    }
  });

  describe('vue-await-trigger rule', () => {
    const rule = (): AuditRule => findRule(vueAuditRules(), 'vue-await-trigger');

    it('flags a trigger() call that is not awaited', () => {
      expect(check(rule(), "wrapper.trigger('click')")).toBe(AWAIT_MSG);
    });

    it('passes when trigger() is awaited', () => {
      expect(check(rule(), "await wrapper.trigger('click')")).toBeNull();
    });

    it('passes when trigger() is returned', () => {
      expect(check(rule(), "return wrapper.trigger('keydown')")).toBeNull();
    });

    it('passes on a line that does not call trigger()', () => {
      expect(check(rule(), "expect(wrapper.text()).toBe('1')")).toBeNull();
    });
  });
});
