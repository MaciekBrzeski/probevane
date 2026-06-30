import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeProject, DEFAULT_QUALITY, type QualityReport } from '../src/quality/analyze.js';
import { violationKey, writeBaseline, applyBaseline } from '../src/quality/baseline.js';
import { selectInputPaths } from '../src/quality/scan.js';
import { toSarif } from '../src/quality/sarif.js';

const CFG = { ...DEFAULT_QUALITY, maxFnLoc: 2, maxParams: 2 };
const SRC = ['function foo(a, b, c) {', '  const x = 1;', '  return a + b + c + x;', '}'].join('\n');

function reportFor(source: string): QualityReport {
  return analyzeProject([{ file: 'a.ts', source }], CFG);
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'pv-base-'));
}

describe('quality baseline (ratchet)', () => {
  it('analyzeProject yields the two expected violations for the fixture', () => {
    const r = reportFor(SRC);
    expect(r.violations.map((v) => v.rule).sort()).toEqual(['fn-size', 'params']);
  });

  it('violationKey strips the changing "(N > M)" tail (line-shift robust)', () => {
    const fnSize = reportFor(SRC).violations.find((v) => v.rule === 'fn-size')!;
    expect(violationKey(fnSize)).toBe('a.ts::fn-size::function foo too long');
  });

  it('applyBaseline suppresses every baselined violation and recomputes counts', () => {
    const dir = tmp();
    const r = reportFor(SRC);
    writeBaseline(dir, r);
    const applied = applyBaseline(dir, r);
    expect(applied.violations).toHaveLength(0);
    expect(applied.errors).toBe(0);
    expect(applied.warns).toBe(0);
    expect(applied.score).toBe(100);
  });

  it('keeps exactly the NEW violation that is not in the baseline', () => {
    const dir = tmp();
    const r = reportFor(SRC);
    writeBaseline(dir, r);
    const extra = {
      file: 'a.ts', line: 1, rule: 'complexity', severity: 'error' as const,
      message: 'function foo too complex (cyclomatic) (13 > 12)', value: 13, threshold: 12,
    };
    const r2: QualityReport = { ...r, violations: [...r.violations, extra] };
    const applied = applyBaseline(dir, r2);
    expect(applied.violations).toHaveLength(1);
    expect(applied.violations[0].rule).toBe('complexity');
    expect(applied.errors).toBe(1);
  });

  it('still suppresses a baselined violation after its lines shift', () => {
    const dir = tmp();
    writeBaseline(dir, reportFor(SRC));
    const shifted = applyBaseline(dir, reportFor('\n\n\n' + SRC));
    expect(shifted.violations).toHaveLength(0);
  });

  it('returns the report unchanged when no baseline file exists', () => {
    const r = reportFor(SRC);
    expect(applyBaseline(tmp(), r).violations).toHaveLength(r.violations.length);
  });
});

describe('quality --since selection', () => {
  it('returns all paths when no changed-list is given (full scan)', () => {
    expect(selectInputPaths(['a.ts', 'b.ts'], undefined)).toEqual(['a.ts', 'b.ts']);
  });
  it('keeps only the changed subset', () => {
    expect(selectInputPaths(['a.ts', 'b.ts', 'c.ts'], ['b.ts'])).toEqual(['b.ts']);
  });
  it('drops changed paths that are not in the walked set', () => {
    expect(selectInputPaths(['a.ts', 'b.ts'], ['x.ts'])).toEqual([]);
  });
});

describe('quality SARIF output', () => {
  const report: QualityReport = {
    files: [], functions: 0,
    violations: [
      { file: 'a.ts', line: 3, rule: 'fn-size', severity: 'error', message: 'function foo too long (60 > 50)', value: 60, threshold: 50 },
      { file: 'b.ts', line: 7, rule: 'params', severity: 'warn', message: 'function bar has too many params (6 > 5)', value: 6, threshold: 5 },
    ],
    duplication: [], duplicationCapped: false, errors: 1, warns: 1, score: 93,
  };

  it('emits a SARIF 2.1.0 log with one result per violation', () => {
    const s = toSarif(report) as any;
    expect(s.version).toBe('2.1.0');
    expect(s.$schema).toContain('json.schemastore.org/sarif-2.1.0.json');
    expect(s.runs[0].tool.driver.name).toBe('probevane-quality');
    expect(s.runs[0].results).toHaveLength(2);
  });

  it('maps the first violation to a SARIF result (ruleId/level/uri/startLine)', () => {
    const first = (toSarif(report) as any).runs[0].results[0];
    expect(first.ruleId).toBe('fn-size');
    expect(first.level).toBe('error');
    expect(first.message.text).toBe('function foo too long (60 > 50)');
    expect(first.locations[0].physicalLocation.artifactLocation.uri).toBe('a.ts');
    expect(first.locations[0].physicalLocation.region.startLine).toBe(3);
  });

  it('maps warn severity to the SARIF "warning" level', () => {
    expect((toSarif(report) as any).runs[0].results[1].level).toBe('warning');
  });
});
