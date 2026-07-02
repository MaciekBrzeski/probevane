import { describe, it, expect } from 'vitest';
import { auditSource } from '../src/audit/core.js';
import { jsAuditRules } from '../src/audit/rules-js.js';

// False-positive regressions — every case here fired on probevane's OWN suite
// (53 errors) before the rules learned these distinctions. Each describe pins
// one fix; the "still catches" cases prove the rules kept their teeth.

const rulesOf = (src: string, file = 'a.test.ts') => auditSource(file, src, jsAuditRules()).map((v) => v.rule);

describe('conditional-expect — TS narrowing exemption', () => {
  it('allows a guard the previous line already asserted (discriminated union)', () => {
    const src = [
      `const d = await gate.shouldStop(ctx);`,
      `expect(d.kind).toBe('block');`,
      `if (d.kind === 'block') expect(d.reason).toContain('no plan');`,
    ].join('\n');
    expect(rulesOf(src)).not.toContain('conditional-expect');
  });

  it('allows negation narrowing (if (!r.ok) after expect(r.ok))', () => {
    const src = [`expect(r.ok).toBe(false);`, `if (!r.ok) expect(r.error).toContain('dir');`].join('\n');
    expect(rulesOf(src)).not.toContain('conditional-expect');
  });

  it('allows the guard asserted with a custom message (expect(x, msg))', () => {
    const src = [
      `expect(d.kind, 'should block').toBe('block');`,
      `if (d.kind === 'block') expect(d.reason).toContain('scope');`,
    ].join('\n');
    expect(rulesOf(src)).not.toContain('conditional-expect');
  });

  it('still catches a genuinely conditional expect (no prior assert)', () => {
    // probevane-allow: conditional-expect — the smell is the fixture under test
    expect(rulesOf(`if (result) expect(result.value).toBe(1);`)).toContain('conditional-expect');
  });

  it('still catches short-circuit expects', () => {
    // probevane-allow: conditional-expect — the smell is the fixture under test
    expect(rulesOf(`ok && expect(x).toBe(1);`)).toContain('conditional-expect');
  });
});

describe('assertion-free-block — hooks + string fixtures', () => {
  it('does not flag beforeAll/afterAll/beforeEach hooks', () => {
    const src = [
      `test.beforeAll(async () => {`,
      `  server = spawn('npx', ['tsx', 'serve.ts']);`,
      `});`,
      `test.afterAll(() => { server.kill(); });`,
    ].join('\n');
    expect(rulesOf(src, 'a.spec.ts')).not.toContain('assertion-free-block');
  });

  it("does not flag test('x', …) inside a fixture STRING", () => {
    const src = [
      `it('writes a spec fixture', async () => {`,
      `  await writeFile(p, 'test("x", () => {});\\n');`,
      `  expect(readFileSync(p, 'utf8')).toContain('test');`,
      `});`,
    ].join('\n');
    expect(rulesOf(src)).not.toContain('assertion-free-block');
  });

  it('brace inside a string no longer truncates the body scan', () => {
    const src = [
      `it('handles } in strings', () => {`,
      `  const out = factDigest('const S = { v: "a}" };');`,
      `  expect(out).toContain('const S');`,
      `});`,
    ].join('\n');
    expect(rulesOf(src)).not.toContain('assertion-free-block');
  });

  it('still catches a real assertion-free test', () => {
    const src = [`it('does nothing', async () => {`, `  await page.goto('/');`, `});`].join('\n');
    expect(rulesOf(src, 'a.spec.ts')).toContain('assertion-free-block');
  });
});

describe('no-wait-for-timeout + missing-status-assert — string fixtures are data', () => {
  it('waitForTimeout inside a fixture string is not a call', () => {
    const src = `const DIRTY = 'await page.waitForTimeout(5000);';\nexpect(score(DIRTY)).toBe(-1);`;
    expect(rulesOf(src)).not.toContain('no-wait-for-timeout');
  });

  it('still catches a real waitForTimeout call', () => {
    expect(rulesOf(`await page.waitForTimeout(3000);`, 'a.spec.ts')).toContain('no-wait-for-timeout');
  });

  it('.post inside a fixture string needs no status assert', () => {
    const src = `writeFileSync(f, "export const a = () => axios.post('/api/orders');\\n");\nexpect(existsSync(f)).toBe(true);`;
    expect(rulesOf(src)).not.toContain('missing-status-assert');
  });

  it('still catches a real un-asserted POST', () => {
    expect(rulesOf(`await request.post('/api/orders', { data });`, 'a.spec.ts')).toContain('missing-status-assert');
  });
});
