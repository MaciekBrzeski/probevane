import { describe, it, expect } from 'vitest';
import { rustAuditRules } from './rules-rust';
import type { AuditRule } from '../adapters/adapter';

// rustAuditRules() and every rule's check() are pure functions over strings:
// no network, clock, or randomness, so these tests are inherently hermetic.

function findRule(rules: AuditRule[], id: string): AuditRule {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`expected rule '${id}' to exist`);
  return rule;
}

// Single-line invocation: lineNo/file/full default to the line itself.
function checkLine(rule: AuditRule, line: string): string | null {
  return rule.check(line, 1, 'spec.test.ts', line);
}

const SLEEP_MSG = 'thread::sleep in a test is brittle — synchronize instead';
const IGNORE_MSG = 'ignored test — it covers nothing';

describe('rustAuditRules', () => {
  it('returns exactly three rules', () => {
    expect(rustAuditRules()).toHaveLength(3);
  });

  it('exposes exactly the expected rule ids in order', () => {
    const ids = rustAuditRules().map((r) => r.id);
    expect(ids).toEqual(['rust-no-sleep', 'rust-no-ignore', 'rust-assert-in-test']);
  });

  it('exposes well-formed rules (non-empty id, valid severity, callable check)', () => {
    const rules = rustAuditRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(typeof rule.id).toBe('string');
      expect(rule.id.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(rule.severity);
      expect(typeof rule.check).toBe('function');
    }
  });

  it('assigns the documented severities', () => {
    expect(findRule(rustAuditRules(), 'rust-no-sleep').severity).toBe('error');
    expect(findRule(rustAuditRules(), 'rust-no-ignore').severity).toBe('warn');
    expect(findRule(rustAuditRules(), 'rust-assert-in-test').severity).toBe('error');
  });

  describe('rust-no-sleep rule', () => {
    const rule = (): AuditRule => findRule(rustAuditRules(), 'rust-no-sleep');

    it('flags a thread::sleep call', () => {
      expect(checkLine(rule(), '    thread::sleep(Duration::from_secs(1));')).toBe(SLEEP_MSG);
    });

    it('passes a line with no sleep', () => {
      expect(checkLine(rule(), 'let x = compute();')).toBeNull();
    });

    it('respects word boundaries (does not flag my_thread::sleeper)', () => {
      expect(checkLine(rule(), 'my_thread::sleeper();')).toBeNull();
    });
  });

  describe('rust-no-ignore rule', () => {
    const rule = (): AuditRule => findRule(rustAuditRules(), 'rust-no-ignore');

    it('flags an #[ignore] attribute', () => {
      expect(checkLine(rule(), '#[ignore]')).toBe(IGNORE_MSG);
    });

    it('passes a line without #[ignore]', () => {
      expect(checkLine(rule(), '#[test]')).toBeNull();
    });
  });

  describe('rust-assert-in-test rule', () => {
    const rule = (): AuditRule => findRule(rustAuditRules(), 'rust-assert-in-test');

    it('passes a #[test] fn that asserts within 30 lines', () => {
      const full = ['#[test]', 'fn adds() {', '    assert_eq!(2, 1 + 1);', '}'].join('\n');
      expect(rule().check('fn adds() {', 2, 'lib.rs', full)).toBeNull();
    });

    it('flags a #[test] fn with no assertion in its body', () => {
      const full = ['#[test]', 'fn does_nothing() {', '    let _x = 1;', '}'].join('\n');
      expect(rule().check('fn does_nothing() {', 2, 'lib.rs', full)).toBe(
        'does_nothing has no assertion within 30 lines',
      );
    });

    it('treats .unwrap() in the body as an assertion', () => {
      const full = ['#[test]', 'fn opens() {', '    File::open("x").unwrap();', '}'].join('\n');
      expect(rule().check('fn opens() {', 2, 'lib.rs', full)).toBeNull();
    });

    it('ignores a fn that is not preceded by #[test]', () => {
      const full = ['fn helper() {', '    let _x = 1;', '}'].join('\n');
      expect(rule().check('fn helper() {', 1, 'lib.rs', full)).toBeNull();
    });

    it('ignores a line under #[test] that declares no fn', () => {
      const full = ['#[test]', '// a comment, not a declaration'].join('\n');
      expect(rule().check('// a comment, not a declaration', 2, 'lib.rs', full)).toBeNull();
    });
  });
});
