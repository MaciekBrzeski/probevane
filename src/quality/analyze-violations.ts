// Quality-violation constructors, split out of analyze.ts to keep each file under
// the analyzer's own size bar. mkViolation takes a single options object (was 7
// positional params); the file/fn-level checks build the standard violation list.
import type { QViolation, QualityConfig, FileReport, FnMetric } from './analyze.js';

interface ViolationSpec {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warn';
  value: number;
  threshold: number;
  what: string;
}

/** A single violation with the analyzer's standard `(value > threshold)` message. */
export function mkViolation(s: ViolationSpec): QViolation {
  return {
    file: s.file,
    line: s.line,
    rule: s.rule,
    severity: s.severity,
    value: s.value,
    threshold: s.threshold,
    message: `${s.what} (${s.value} > ${s.threshold})`,
  };
}

/** File-level violations (size, import fan-out, long lines, debt markers). */
export function fileLevelViolations(f: FileReport, cfg: QualityConfig): QViolation[] {
  const v: QViolation[] = [];
  if (f.loc > cfg.maxFileLoc) {
    v.push(mkViolation({
      file: f.file, line: 1, rule: 'file-size', severity: 'error',
      value: f.loc, threshold: cfg.maxFileLoc, what: 'file too long',
    }));
  }
  if (f.imports > cfg.maxImports) {
    v.push(mkViolation({
      file: f.file, line: 1, rule: 'import-fanout', severity: 'warn',
      value: f.imports, threshold: cfg.maxImports, what: 'too many imports',
    }));
  }
  if (f.longLines > 0) {
    v.push(mkViolation({
      file: f.file, line: f.longLineNos[0], rule: 'long-lines', severity: 'warn',
      value: f.longLines, threshold: 0, what: `${f.longLines} line(s) over ${cfg.maxLineWidth} chars`,
    }));
  }
  if (f.debt > 0) {
    v.push(mkViolation({
      file: f.file, line: f.debtLineNos[0], rule: 'debt', severity: 'warn',
      value: f.debt, threshold: 0, what: `${f.debt} debt marker(s)`,
    }));
  }
  return v;
}

/** Per-function violations (size, cyclomatic, cognitive, nesting, params). */
export function fnLevelViolations(file: string, fn: FnMetric, cfg: QualityConfig): QViolation[] {
  const v: QViolation[] = [];
  if (fn.loc > cfg.maxFnLoc) {
    v.push(mkViolation({
      file, line: fn.startLine, rule: 'fn-size', severity: 'error',
      value: fn.loc, threshold: cfg.maxFnLoc, what: `function ${fn.name} too long`,
    }));
  }
  if (fn.complexity > cfg.maxComplexity) {
    v.push(mkViolation({
      file, line: fn.startLine, rule: 'complexity', severity: 'error',
      value: fn.complexity, threshold: cfg.maxComplexity, what: `function ${fn.name} too complex (cyclomatic)`,
    }));
  }
  if (fn.cognitive > cfg.maxCognitive) {
    v.push(mkViolation({
      file, line: fn.startLine, rule: 'cognitive', severity: 'warn',
      value: fn.cognitive, threshold: cfg.maxCognitive, what: `function ${fn.name} cognitively complex (nesting-weighted)`,
    }));
  }
  if (fn.nesting > cfg.maxNesting) {
    v.push(mkViolation({
      file, line: fn.startLine, rule: 'nesting', severity: 'warn',
      value: fn.nesting, threshold: cfg.maxNesting, what: `function ${fn.name} nested too deep`,
    }));
  }
  if (fn.params > cfg.maxParams) {
    v.push(mkViolation({
      file, line: fn.startLine, rule: 'params', severity: 'warn',
      value: fn.params, threshold: cfg.maxParams, what: `function ${fn.name} has too many params`,
    }));
  }
  return v;
}
