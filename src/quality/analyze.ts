// Project source-quality analyzer (Phase 5). Pure, heuristic, language-agnostic-
// ish (tuned for TS/JS): given {file, source} pairs it measures file size,
// per-function length / parameter count / branch-complexity / nesting depth, long
// lines, debt markers (TODO/FIXME/…), import fan-out, and cross-file duplication,
// then flags anything over a threshold. It's a GATE input — heuristic by design
// (flags for a human/loop to act on), not a parser. No I/O: the CLI walks files.

export interface QualityConfig {
  maxFileLoc: number; // lines per file
  maxFnLoc: number; // lines per function
  maxComplexity: number; // branch points per function (cyclomatic-ish; ESLint default 20)
  maxCognitive: number; // nesting-weighted readability cost per function (SonarQube default 15)
  maxNesting: number; // brace-nesting depth per function
  maxParams: number; // parameters per function
  maxLineWidth: number; // characters per line
  maxImports: number; // import/require statements per file
  dupMinLines: number; // window size for duplicate-block detection
  debt: boolean; // flag TODO/FIXME/HACK/XXX markers
}

export const DEFAULT_QUALITY: QualityConfig = {
  maxFileLoc: 300,
  maxFnLoc: 50,
  maxComplexity: 12,
  maxCognitive: 15,
  maxNesting: 4,
  maxParams: 5,
  maxLineWidth: 120,
  maxImports: 20,
  dupMinLines: 6,
  debt: true,
};

export interface QViolation {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warn';
  message: string;
  value: number;
  threshold: number;
}

export interface FnMetric {
  name: string;
  startLine: number;
  endLine: number;
  loc: number;
  params: number;
  complexity: number; // cyclomatic-ish (branch count + 1)
  cognitive: number; // nesting-weighted (each branch costs 1 + its nesting depth)
  nesting: number;
}

export interface FileReport {
  file: string;
  loc: number;
  imports: number;
  longLines: number;
  debt: number;
  longLineNos: number[]; // 1-based lines exceeding maxLineWidth
  debtLineNos: number[]; // 1-based lines with a debt marker (in a comment)
  functions: FnMetric[];
}

export interface Dup {
  lines: number; // size of the duplicated block
  count: number; // how many times it appears
  occurrences: { file: string; startLine: number }[];
}

export interface QualityReport {
  files: FileReport[];
  functions: number;
  violations: QViolation[];
  duplication: Dup[];
  duplicationCapped: boolean; // true if more duplicate blocks existed than the report cap
  errors: number;
  warns: number;
  score: number; // 0..100 health grade
}

// String/comment stripping + heuristic function detection live in a sibling file
// to keep each function/file under the analyzer's own quality bar; re-exported
// here so the public API (stripToCode, detectFunctions) is unchanged.
import { stripToCode, detectFunctions } from './analyze-detect.js';
export { stripToCode, detectFunctions };

const DEBT = /\b(TODO|FIXME|HACK|XXX)\b/;

/** The comment portion of a line (after `//`, or inside a block comment), or ''. */
function commentText(line: string): string {
  const slash = line.indexOf('//');
  if (slash >= 0) return line.slice(slash + 2);
  const m = line.match(/\/\*(.*?)(\*\/|$)/);
  return m ? m[1] : '';
}

export function analyzeFile(file: string, source: string, cfg: QualityConfig): FileReport {
  const lines = source.split('\n');
  const code = stripToCode(lines);
  const imports = code.filter((l) => /^\s*import\b/.test(l) || /\brequire\s*\(/.test(l)).length;
  const longLineNos: number[] = [];
  const debtLineNos: number[] = [];
  lines.forEach((l, i) => {
    // Measure the CODE width (strings collapsed, comments removed) — a line that's
    // long only because of a string literal / data row / comment / URL is not a
    // code-complexity smell, so it shouldn't trip the long-line rule (was a misfire
    // on the command table, config templates, and trailing-comment lines).
    if (code[i].length > cfg.maxLineWidth) longLineNos.push(i + 1);
    // Debt only counts inside a COMMENT — not in a string literal or identifier.
    if (cfg.debt && DEBT.test(commentText(l))) debtLineNos.push(i + 1);
  });
  return {
    file,
    loc: lines.length,
    imports,
    longLines: longLineNos.length,
    debt: debtLineNos.length,
    longLineNos,
    debtLineNos,
    functions: detectFunctions(source),
  };
}

const DUP_CAP = 25;

/** Cross-file duplicate-block detection — reports MAXIMAL blocks, not fixed-size
 *  windows. A duplicated 10-line block is one Dup of `lines:10`, not five
 *  overlapping 6-line ones. Returns whether the report was capped. */
export function findDuplication(
  perFile: { file: string; code: string[] }[],
  minLines: number,
): { dups: Dup[]; capped: boolean } {
  const norm = (l: string) => l.trim().replace(/\s+/g, ' ');
  const trivial = (l: string) => l.length <= 2; // '', '}', '{', ');' etc.
  const normed = perFile.map((f) => ({ file: f.file, code: f.code.map(norm) }));

  // Hash every minLines window → its occurrences (file + 0-based index).
  const seen = new Map<string, { file: string; idx: number }[]>();
  for (const { file, code } of normed) {
    for (let i = 0; i + minLines <= code.length; i++) {
      const window = code.slice(i, i + minLines);
      if (window.filter((l) => !trivial(l)).length < minLines) continue; // mostly-blank
      const key = window.join('\n');
      (seen.get(key) ?? seen.set(key, []).get(key)!).push({ file, idx: i });
    }
  }
  const codeOf = new Map(normed.map((f) => [f.file, f.code] as const));
  const groups = [...seen.values()]
    .filter((occ) => occ.length >= 2)
    .sort((a, b) => a[0].file.localeCompare(b[0].file) || a[0].idx - b[0].idx);

  const covered = new Set<string>(); // `${file}:${idx}` windows already inside an emitted block
  const dups: Dup[] = [];
  for (const occ of groups) {
    if (occ.some((o) => covered.has(`${o.file}:${o.idx}`))) continue;
    // Extend the block while ALL occurrences keep matching the next line.
    let len = minLines;
    while (true) {
      const next = occ.map((o) => codeOf.get(o.file)?.[o.idx + len]);
      if (next.some((x) => x === undefined) || new Set(next).size !== 1) break;
      len++;
    }
    for (const o of occ) for (let k = 0; k <= len - minLines; k++) covered.add(`${o.file}:${o.idx + k}`);
    dups.push({
      lines: len,
      count: occ.length,
      occurrences: occ.map((o) => ({ file: o.file, startLine: o.idx + 1 })),
    });
  }
  dups.sort((a, b) => b.lines * b.count - a.lines * a.count);
  return { dups: dups.slice(0, DUP_CAP), capped: dups.length > DUP_CAP };
}

/** A single violation with the analyzer's standard `(value > threshold)` message. */
function mkViolation(
  file: string,
  line: number,
  rule: string,
  severity: 'error' | 'warn',
  value: number,
  threshold: number,
  what: string,
): QViolation {
  return { file, line, rule, severity, value, threshold, message: `${what} (${value} > ${threshold})` };
}

/** File-level violations (size, import fan-out, long lines, debt markers). */
function fileLevelViolations(f: FileReport, cfg: QualityConfig): QViolation[] {
  const v: QViolation[] = [];
  if (f.loc > cfg.maxFileLoc) v.push(mkViolation(f.file, 1, 'file-size', 'error', f.loc, cfg.maxFileLoc, 'file too long'));
  if (f.imports > cfg.maxImports)
    v.push(mkViolation(f.file, 1, 'import-fanout', 'warn', f.imports, cfg.maxImports, 'too many imports'));
  if (f.longLines > 0)
    v.push(mkViolation(f.file, f.longLineNos[0], 'long-lines', 'warn', f.longLines, 0, `${f.longLines} line(s) over ${cfg.maxLineWidth} chars`));
  if (f.debt > 0) v.push(mkViolation(f.file, f.debtLineNos[0], 'debt', 'warn', f.debt, 0, `${f.debt} debt marker(s)`));
  return v;
}

/** Per-function violations (size, cyclomatic, cognitive, nesting, params). */
function fnLevelViolations(file: string, fn: FnMetric, cfg: QualityConfig): QViolation[] {
  const v: QViolation[] = [];
  if (fn.loc > cfg.maxFnLoc)
    v.push(mkViolation(file, fn.startLine, 'fn-size', 'error', fn.loc, cfg.maxFnLoc, `function ${fn.name} too long`));
  if (fn.complexity > cfg.maxComplexity)
    v.push(mkViolation(file, fn.startLine, 'complexity', 'error', fn.complexity, cfg.maxComplexity, `function ${fn.name} too complex (cyclomatic)`));
  if (fn.cognitive > cfg.maxCognitive)
    v.push(mkViolation(file, fn.startLine, 'cognitive', 'warn', fn.cognitive, cfg.maxCognitive, `function ${fn.name} cognitively complex (nesting-weighted)`));
  if (fn.nesting > cfg.maxNesting)
    v.push(mkViolation(file, fn.startLine, 'nesting', 'warn', fn.nesting, cfg.maxNesting, `function ${fn.name} nested too deep`));
  if (fn.params > cfg.maxParams)
    v.push(mkViolation(file, fn.startLine, 'params', 'warn', fn.params, cfg.maxParams, `function ${fn.name} has too many params`));
  return v;
}

export function analyzeProject(
  inputs: { file: string; source: string }[],
  cfg: QualityConfig = DEFAULT_QUALITY,
): QualityReport {
  const files = inputs.map((x) => analyzeFile(x.file, x.source, cfg));
  const violations: QViolation[] = [];

  let fnCount = 0;
  for (const f of files) {
    fnCount += f.functions.length;
    violations.push(...fileLevelViolations(f, cfg));
    for (const fn of f.functions) violations.push(...fnLevelViolations(f.file, fn, cfg));
  }

  const { dups: duplication, capped: duplicationCapped } = findDuplication(
    inputs.map((x) => ({ file: x.file, code: stripToCode(x.source.split('\n')) })),
    cfg.dupMinLines,
  );
  for (const d of duplication) {
    const o = d.occurrences[0];
    violations.push(mkViolation(o.file, o.startLine, 'duplication', 'warn', d.count, 1, `${d.lines}-line block duplicated ${d.count}×`));
  }

  const errors = violations.filter((v) => v.severity === 'error').length;
  const warns = violations.filter((v) => v.severity === 'warn').length;
  const score = Math.max(0, 100 - errors * 5 - warns * 2);
  return { files, functions: fnCount, violations, duplication, duplicationCapped, errors, warns, score };
}

export function formatQuality(r: QualityReport): string {
  const lines = r.violations
    .slice()
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
    .map((v) => `${v.file}:${v.line}: ${v.severity}: [${v.rule}] ${v.message}`);
  return lines.join('\n');
}
