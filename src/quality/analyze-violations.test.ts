import { describe, it, expect } from 'vitest';
import { mkViolation, fileLevelViolations, fnLevelViolations } from './analyze-violations.js';
import { DEFAULT_QUALITY } from './analyze.js';
import type { QualityConfig, FileReport, FnMetric } from './analyze.js';

const cfg: QualityConfig = DEFAULT_QUALITY;

function mkFile(partial: Partial<FileReport> = {}): FileReport {
  return {
    file: 'src/foo.ts',
    loc: 10,
    imports: 0,
    longLines: 0,
    debt: 0,
    longLineNos: [],
    debtLineNos: [],
    functions: [],
    ...partial,
  };
}

function mkFn(partial: Partial<FnMetric> = {}): FnMetric {
  return {
    name: 'doThing',
    startLine: 7,
    endLine: 20,
    loc: 10,
    params: 1,
    complexity: 2,
    cognitive: 3,
    nesting: 1,
    ...partial,
  };
}

describe('mkViolation', () => {
  it('copies every field verbatim and formats the message (error spec)', () => {
    const v = mkViolation({
      file: 'a.ts', line: 42, rule: 'file-size', severity: 'error',
      value: 500, threshold: 300, what: 'file too long',
    });
    expect(v.file).toBe('a.ts');
    expect(v.line).toBe(42);
    expect(v.rule).toBe('file-size');
    expect(v.severity).toBe('error');
    expect(v.value).toBe(500);
    expect(v.threshold).toBe(300);
    expect(v.message).toBe('file too long (500 > 300)');
  });

  it('formats the message for a warn spec', () => {
    const v = mkViolation({
      file: 'b.ts', line: 1, rule: 'params', severity: 'warn',
      value: 7, threshold: 5, what: 'function f has too many params',
    });
    expect(v.severity).toBe('warn');
    expect(v.message).toBe('function f has too many params (7 > 5)');
    expect(v).toEqual({
      file: 'b.ts', line: 1, rule: 'params', severity: 'warn',
      value: 7, threshold: 5, message: 'function f has too many params (7 > 5)',
    });
  });
});

describe('fileLevelViolations', () => {
  it('returns no violations for a clean file', () => {
    expect(fileLevelViolations(mkFile(), cfg)).toEqual([]);
  });

  it('does not flag file-size at the boundary (strictly greater)', () => {
    const v = fileLevelViolations(mkFile({ loc: cfg.maxFileLoc }), cfg);
    expect(v.find((x) => x.rule === 'file-size')).toBeUndefined();
  });

  it('flags file-size as error at line 1 when loc exceeds the ceiling', () => {
    const v = fileLevelViolations(mkFile({ loc: cfg.maxFileLoc + 5 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('file-size');
    expect(v[0].severity).toBe('error');
    expect(v[0].line).toBe(1);
    expect(v[0].value).toBe(cfg.maxFileLoc + 5);
    expect(v[0].threshold).toBe(cfg.maxFileLoc);
    expect(v[0].message).toBe(`file too long (${cfg.maxFileLoc + 5} > ${cfg.maxFileLoc})`);
  });

  it('flags import-fanout as warn at line 1 when imports exceed the ceiling', () => {
    const v = fileLevelViolations(mkFile({ imports: cfg.maxImports + 1 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('import-fanout');
    expect(v[0].severity).toBe('warn');
    expect(v[0].line).toBe(1);
    expect(v[0].value).toBe(cfg.maxImports + 1);
  });

  it('flags long-lines at the first offending line number with threshold 0', () => {
    const v = fileLevelViolations(mkFile({ longLines: 3, longLineNos: [12, 40, 88] }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('long-lines');
    expect(v[0].severity).toBe('warn');
    expect(v[0].line).toBe(12);
    expect(v[0].value).toBe(3);
    expect(v[0].threshold).toBe(0);
    expect(v[0].message).toBe(`3 line(s) over ${cfg.maxLineWidth} chars (3 > 0)`);
  });

  it('flags debt markers at the first debt line number with threshold 0', () => {
    const v = fileLevelViolations(mkFile({ debt: 2, debtLineNos: [5, 9] }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('debt');
    expect(v[0].severity).toBe('warn');
    expect(v[0].line).toBe(5);
    expect(v[0].value).toBe(2);
    expect(v[0].threshold).toBe(0);
    expect(v[0].message).toBe('2 debt marker(s) (2 > 0)');
  });

  it('emits all four file-level violations in a stable order when everything is over', () => {
    const v = fileLevelViolations(mkFile({
      loc: cfg.maxFileLoc + 1,
      imports: cfg.maxImports + 1,
      longLines: 1, longLineNos: [3],
      debt: 1, debtLineNos: [4],
    }), cfg);
    expect(v.map((x) => x.rule)).toEqual(['file-size', 'import-fanout', 'long-lines', 'debt']);
  });
});

describe('fnLevelViolations', () => {
  it('returns no violations for a clean function', () => {
    expect(fnLevelViolations('src/foo.ts', mkFn(), cfg)).toEqual([]);
  });

  it('does not flag fn-size at the boundary (strictly greater)', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ loc: cfg.maxFnLoc }), cfg);
    expect(v).toEqual([]);
  });

  it('flags fn-size as error at startLine when over its ceiling', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ loc: cfg.maxFnLoc + 1 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('fn-size');
    expect(v[0].severity).toBe('error');
    expect(v[0].line).toBe(7);
    expect(v[0].threshold).toBe(cfg.maxFnLoc);
    expect(v[0].file).toBe('src/foo.ts');
    expect(v[0].message).toContain('doThing');
  });

  it('flags complexity as error at startLine when over its ceiling', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ complexity: cfg.maxComplexity + 1 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('complexity');
    expect(v[0].severity).toBe('error');
    expect(v[0].line).toBe(7);
    expect(v[0].threshold).toBe(cfg.maxComplexity);
    expect(v[0].file).toBe('src/foo.ts');
    expect(v[0].message).toContain('doThing');
  });

  it('flags cognitive as warn at startLine when over its ceiling', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ cognitive: cfg.maxCognitive + 1 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('cognitive');
    expect(v[0].severity).toBe('warn');
    expect(v[0].line).toBe(7);
    expect(v[0].threshold).toBe(cfg.maxCognitive);
    expect(v[0].file).toBe('src/foo.ts');
    expect(v[0].message).toContain('doThing');
  });

  it('flags nesting as warn at startLine when over its ceiling', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ nesting: cfg.maxNesting + 1 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('nesting');
    expect(v[0].severity).toBe('warn');
    expect(v[0].line).toBe(7);
    expect(v[0].threshold).toBe(cfg.maxNesting);
    expect(v[0].file).toBe('src/foo.ts');
    expect(v[0].message).toContain('doThing');
  });

  it('flags params as warn at startLine when over its ceiling', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ params: cfg.maxParams + 1 }), cfg);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('params');
    expect(v[0].severity).toBe('warn');
    expect(v[0].line).toBe(7);
    expect(v[0].threshold).toBe(cfg.maxParams);
    expect(v[0].file).toBe('src/foo.ts');
    expect(v[0].message).toContain('doThing');
  });

  it('uses the distinct cyclomatic wording for the complexity rule', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({ complexity: cfg.maxComplexity + 3 }), cfg);
    expect(v[0].message).toBe(
      `function doThing too complex (cyclomatic) (${cfg.maxComplexity + 3} > ${cfg.maxComplexity})`,
    );
  });

  it('emits all five function-level violations in order with correct severities', () => {
    const v = fnLevelViolations('src/foo.ts', mkFn({
      loc: cfg.maxFnLoc + 1,
      complexity: cfg.maxComplexity + 1,
      cognitive: cfg.maxCognitive + 1,
      nesting: cfg.maxNesting + 1,
      params: cfg.maxParams + 1,
    }), cfg);
    expect(v.map((x) => x.rule)).toEqual(['fn-size', 'complexity', 'cognitive', 'nesting', 'params']);
    expect(v.map((x) => x.severity)).toEqual(['error', 'error', 'warn', 'warn', 'warn']);
    expect(v.every((x) => x.line === 7)).toBe(true);
  });
});
