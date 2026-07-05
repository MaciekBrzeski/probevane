import { describe, it, expect } from 'vitest';
import { astExtract } from '../src/adapters/ast-probe.js';
import { sampleSchema } from '../src/mock/synth.js';
import { auditSource } from '../src/audit/core.js';
import { jsAuditRules } from '../src/audit/rules-js.js';
import { isSourceFile, specCandidatesFor } from '../src/git.js';
import { pick } from '../src/util/config.js';
import { routeModels } from '../src/loop/complexity.js';
import { gapsDigest } from '../src/coverage/gaps.js';
import { assessComplexity } from '../src/loop/complexity.js';

describe('ast-probe.astExtract', () => {
  it('extracts async function with params and return type', () => {
    const f = astExtract('export async function load(id: number): Promise<string> { return ""; }', 'a.ts')!;
    const e = f.exports.find((x) => x.name === 'load')!;
    expect(e.signature).toContain('async load(id: number)');
    expect(e.signature).toContain('Promise<string>');
    expect(e.isComponent).toBe(false);
  });
  it('detects a component only in a .tsx file', () => {
    const tsx = astExtract('export function Btn() { return null as any; }', 'B.tsx')!;
    expect(tsx.exports.find((x) => x.name === 'Btn')!.isComponent).toBe(true);
    const ts = astExtract('export function Btn() { return 1; }', 'B.ts')!;
    expect(ts.exports.find((x) => x.name === 'Btn')!.isComponent).toBe(false);
  });
  it('filters type-only exports and reads Props interfaces', () => {
    const f = astExtract('export interface FooProps { a: string; b?: number } export type T = number;', 'a.tsx')!;
    expect(f.exports.find((x) => x.name === 'T')).toBeUndefined();
    expect(f.props.join()).toContain('FooProps');
    expect(f.props.join()).toContain('b?: number');
  });
  it('reads destructured + default exports (redux slice shape)', () => {
    const src = 'const s={actions:{},reducer:0}; export const { add, remove } = s.actions; export default s.reducer;';
    const names = astExtract(src, 's.ts')!.exports.map((e) => e.name);
    expect(names).toContain('add');
    expect(names).toContain('remove');
    expect(names).toContain('default');
  });
});

describe('mock/synth.sampleSchema', () => {
  it('samples an object from properties', () => {
    const v = sampleSchema({ type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, ok: { type: 'boolean' } } }, {}) as any;
    expect(v.id).toBe(1);
    expect(typeof v.name).toBe('string');
    expect(v.ok).toBe(true);
  });
  it('resolves $ref + arrays of two', () => {
    const comps = { P: { type: 'object', properties: { id: { type: 'integer' } } } };
    const v = sampleSchema({ type: 'array', items: { $ref: '#/components/schemas/P' } }, comps) as any[];
    expect(v).toHaveLength(2);
    expect(v[1].id).toBe(2);
  });
  it('honors enum + example', () => {
    expect(sampleSchema({ enum: ['a', 'b'] }, {})).toBe('a');
    expect(sampleSchema({ example: 42 }, {})).toBe(42);
  });
});

describe('audit/core', () => {
  const rules = jsAuditRules();
  it('flags an assertion-free test + .only', () => {
    const src = `it('x', () => { render(<App/>); });\nit.only('y', () => { expect(1).toBe(1); });`;
    const v = auditSource('a.test.tsx', src, rules);
    expect(v.some((x) => x.rule === 'assertion-free-block')).toBe(true);
    expect(v.some((x) => x.rule === 'no-only')).toBe(true);
  });
  it('respects probevane-allow suppression', () => {
    const src = `// probevane-allow: no-only\nit.only('y', () => { expect(1).toBe(1); });`;
    expect(auditSource('a.test.tsx', src, rules).some((x) => x.rule === 'no-only')).toBe(false);
  });
});

describe('git helpers', () => {
  it('isSourceFile excludes specs/config/generated', () => {
    expect(isSourceFile('src/App.tsx')).toBe(true);
    expect(isSourceFile('src/App.test.tsx')).toBe(false);
    expect(isSourceFile('vitest.config.ts')).toBe(false);
    expect(isSourceFile('src/mocks/handlers.ts')).toBe(false);
    expect(isSourceFile('calc_test.go')).toBe(false);
    expect(isSourceFile('calc.go')).toBe(true);
  });
  it('maps source to sibling spec candidates', () => {
    expect(specCandidatesFor('src/format.ts')).toContain('src/format.test.ts');
    expect(specCandidatesFor('pkg/calc.py')).toContain('pkg/test_calc.py');
  });
});

describe('config.pick precedence', () => {
  it('flag > config > default', () => {
    expect(pick(7, 9, 5)).toBe(7);
    expect(pick(undefined, 9, 5)).toBe(9);
    expect(pick(undefined, undefined, 5)).toBe(5);
  });
});

describe('complexity.routeModels', () => {
  it('auto routes complex→sonnet, simple→haiku', () => {
    expect(routeModels('auto', true).primary).toContain('sonnet');
    expect(routeModels('auto', false).primary).toContain('haiku');
  });
  it('honors explicit + local choices', () => {
    expect(routeModels('opus', false).primary).toContain('opus');
    expect(routeModels('local:llama', false).primary).toBe('local:llama');
  });
});

describe('coverage.gapsDigest', () => {
  it('formats uncovered fns + lines', () => {
    const d = gapsDigest([{ file: 'src/a.ts', uncoveredLines: [3, 4], uncoveredFns: ['foo'] }]);
    expect(d).toContain('src/a.ts');
    expect(d).toContain('foo');
    expect(d).toContain('3,4');
  });
  it('empty when no gaps', () => {
    expect(gapsDigest([])).toBe('');
  });
});

describe('ast-probe arrow + props type-alias', () => {
  it('reads an exported arrow signature', () => {
    const f = astExtract('export const add = (a: number, b: number) => a + b;', 'a.ts')!;
    expect(f.exports.find((x) => x.name === 'add')!.signature).toContain('add(a: number, b: number)');
  });
  it('reads a Props type alias', () => {
    const f = astExtract('export type RowProps = { id: number };', 'a.tsx')!;
    expect(f.props.join()).toContain('RowProps');
  });
});

describe('complexity.assessComplexity (reads a fixture graph)', () => {
  it('small fixture is simple', async () => {
    const cx = await assessComplexity('fixtures/react-todo', []);
    expect(cx.complex).toBe(false);
  });
});
