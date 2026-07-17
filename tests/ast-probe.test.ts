import { describe, it, expect } from 'vitest';
import { astExtract } from '../src/adapters/ast-probe.js';

describe('ast-probe astExtract — AST export/prop extraction', () => {
  it('extracts an exported function (not a component in a .ts file)', () => {
    const f = astExtract('export function add(a: number, b: number) { return a + b; }', 'calc.ts');
    expect(f).not.toBeNull();
    const add = f!.exports.find((e) => e.name === 'add');
    expect(add).toBeDefined();
    expect(add!.isComponent).toBe(false);
    expect(add!.signature).toContain('add');
  });

  it('flags a PascalCase arrow in a .tsx file as a component', () => {
    const f = astExtract('export const Widget = (p: { label: string }) => null;', 'Widget.tsx');
    const w = f!.exports.find((e) => e.name === 'Widget');
    expect(w!.isComponent).toBe(true);
  });

  it('a lowercase export in .tsx is NOT a component', () => {
    const f = astExtract('export const helper = (x: number) => x;', 'x.tsx');
    expect(f!.exports.find((e) => e.name === 'helper')!.isComponent).toBe(false);
  });

  it('a PascalCase function in a .ts (non-tsx) file is NOT a component', () => {
    const f = astExtract('export function Widget() { return null; }', 'x.ts');
    expect(f!.exports.find((e) => e.name === 'Widget')!.isComponent).toBe(false);
  });

  it('drops type-only exports (interface / type alias), keeps real units', () => {
    const f = astExtract('export type T = string;\nexport interface I { a: number }\nexport function run() {}', 'x.ts');
    const names = f!.exports.map((e) => e.name);
    expect(names).toContain('run');
    expect(names).not.toContain('T');
    expect(names).not.toContain('I');
  });

  it('empty source yields empty facts (never throws)', () => {
    const f = astExtract('', 'x.ts');
    expect(f).toEqual({ exports: [], props: [] });
  });
});
