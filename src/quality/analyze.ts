// Project source-quality analyzer (Phase 5). Pure, heuristic, language-agnostic-
// ish (tuned for TS/JS): given {file, source} pairs it measures file size,
// per-function length / parameter count / branch-complexity / nesting depth, long
// lines, debt markers (TODO/FIXME/…), import fan-out, and cross-file duplication,
// then flags anything over a threshold. It's a GATE input — heuristic by design
// (flags for a human/loop to act on), not a parser. No I/O: the CLI walks files.

export interface QualityConfig {
  maxFileLoc: number; // lines per file
  maxFnLoc: number; // lines per function
  maxComplexity: number; // branch points per function (cyclomatic-ish)
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
  complexity: number;
  nesting: number;
}

export interface FileReport {
  file: string;
  loc: number;
  imports: number;
  longLines: number;
  debt: number;
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
  errors: number;
  warns: number;
  score: number; // 0..100 health grade
}

const DEBT = /\b(TODO|FIXME|HACK|XXX)\b/;
const BRANCH = /\b(if|for|while|case|catch)\b|&&|\|\|/g;

/** Strip strings + comments to code-only lines (heuristic; multi-line templates may leak). */
export function stripToCode(lines: string[]): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    let s = '';
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf('*/', i);
        if (end === -1) {
          i = raw.length;
        } else {
          i = end + 2;
          inBlock = false;
        }
        continue;
      }
      if (raw.startsWith('//', i)) break;
      if (raw.startsWith('/*', i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      const ch = raw[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i++;
        while (i < raw.length && raw[i] !== ch) {
          if (raw[i] === '\\') i++;
          i++;
        }
        i++; // past closing quote
        s += '""'; // collapse the literal
        continue;
      }
      s += ch;
      i++;
    }
    out.push(s);
  }
  return out;
}

/** Count top-level (depth-0) comma-separated params in a parameter string. */
function countParams(params: string): number {
  const p = params.trim();
  if (!p) return 0;
  let depth = 0,
    count = 1;
  for (const ch of p) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

// Function-header patterns (matched against code-only lines).
const HEADERS: { re: RegExp; name: number; params: number }[] = [
  { re: /\bfunction\b\s*\*?\s*([A-Za-z0-9_$]*)\s*\(([^)]*)\)/, name: 1, params: 2 },
  {
    // Arrow with a BLOCK body only (`=> {`). Expression-body arrows (one-liners)
    // carry no size/complexity worth gating and would let the brace-matcher run
    // away into the next function, so we deliberately skip them.
    re: /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=>]+)?=>\s*\{/,
    name: 1,
    params: 2,
  },
];
const METHOD =
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)*([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*(?::[^={]+)?\{/;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'do', 'else']);

/** Detect non-nested functions in a file (heuristic, brace-matched). */
export function detectFunctions(code: string[]): FnMetric[] {
  const fns: FnMetric[] = [];
  let i = 0;
  while (i < code.length) {
    const line = code[i];
    let name: string | null = null;
    let params = '';
    for (const h of HEADERS) {
      const m = line.match(h.re);
      if (m) {
        name = m[h.name] || '(anonymous)';
        params = m[h.params] ?? '';
        break;
      }
    }
    if (name === null) {
      const m = line.match(METHOD);
      if (m && !KEYWORDS.has(m[1])) {
        name = m[1];
        params = m[2] ?? '';
      }
    }
    if (name === null) {
      i++;
      continue;
    }

    // Brace-match the body. The opening `{` must appear within a few lines of the
    // header (block bodies put it on the header line, occasionally the next for a
    // multi-line signature) and before any `;` — otherwise there's no block body
    // and we bail rather than let the scan escape into a later function.
    let depth = 0,
      started = false,
      maxDepth = 0,
      branches = 0;
    let j = i;
    let openFound = false;
    for (; j < code.length; j++) {
      const t = code[j];
      if (!started && j > i && (j - i > 3 || /;\s*$/.test(t))) break; // no block here → bail
      branches += (t.match(BRANCH) || []).length;
      for (const ch of t) {
        if (ch === '{') {
          depth++;
          started = true;
          openFound = true;
          if (depth - 1 > maxDepth) maxDepth = depth - 1;
        } else if (ch === '}') {
          depth--;
        }
      }
      if (started && depth <= 0) break;
    }
    if (!openFound) {
      i++;
      continue; // no block body (expression arrow / declaration) — skip
    }
    const endLine = Math.min(j, code.length - 1);
    fns.push({
      name,
      startLine: i + 1,
      endLine: endLine + 1,
      loc: endLine - i + 1,
      params: countParams(params),
      complexity: branches + 1,
      nesting: maxDepth,
    });
    i = endLine + 1; // skip past this function (don't re-detect nested)
  }
  return fns;
}

export function analyzeFile(file: string, source: string, cfg: QualityConfig): FileReport {
  const lines = source.split('\n');
  const code = stripToCode(lines);
  const imports = code.filter((l) => /^\s*import\b/.test(l) || /\brequire\s*\(/.test(l)).length;
  const longLines = lines.filter((l) => l.length > cfg.maxLineWidth).length;
  const debt = cfg.debt ? lines.filter((l) => DEBT.test(l)).length : 0;
  return { file, loc: lines.length, imports, longLines, debt, functions: detectFunctions(code) };
}

/** Cross-file duplicate-block detection on normalized code lines. */
export function findDuplication(
  perFile: { file: string; code: string[] }[],
  minLines: number,
): Dup[] {
  const norm = (l: string) => l.trim().replace(/\s+/g, ' ');
  const trivial = (l: string) => l.length <= 2; // '', '}', '{', ');' etc.
  const seen = new Map<string, { file: string; startLine: number }[]>();
  for (const { file, code } of perFile) {
    for (let i = 0; i + minLines <= code.length; i++) {
      const window = code.slice(i, i + minLines).map(norm);
      if (window.filter((l) => !trivial(l)).length < minLines) continue; // mostly-blank block
      const key = window.join('\n');
      (seen.get(key) ?? seen.set(key, []).get(key)!).push({ file, startLine: i + 1 });
    }
  }
  const dups: Dup[] = [];
  for (const occ of seen.values()) {
    if (occ.length >= 2) dups.push({ lines: minLines, count: occ.length, occurrences: occ });
  }
  // Largest / most-repeated first; cap to avoid overlap-window noise flooding the report.
  return dups.sort((a, b) => b.count - a.count).slice(0, 25);
}

export function analyzeProject(
  inputs: { file: string; source: string }[],
  cfg: QualityConfig = DEFAULT_QUALITY,
): QualityReport {
  const files = inputs.map((x) => analyzeFile(x.file, x.source, cfg));
  const violations: QViolation[] = [];
  const push = (
    file: string,
    line: number,
    rule: string,
    severity: 'error' | 'warn',
    value: number,
    threshold: number,
    what: string,
  ) =>
    violations.push({
      file,
      line,
      rule,
      severity,
      value,
      threshold,
      message: `${what} (${value} > ${threshold})`,
    });

  let fnCount = 0;
  for (const f of files) {
    fnCount += f.functions.length;
    if (f.loc > cfg.maxFileLoc) push(f.file, 1, 'file-size', 'error', f.loc, cfg.maxFileLoc, 'file too long');
    if (f.imports > cfg.maxImports)
      push(f.file, 1, 'import-fanout', 'warn', f.imports, cfg.maxImports, 'too many imports');
    if (f.longLines > 0)
      push(f.file, 1, 'long-lines', 'warn', f.longLines, 0, `${f.longLines} line(s) over ${cfg.maxLineWidth} chars`);
    if (f.debt > 0) push(f.file, 1, 'debt', 'warn', f.debt, 0, `${f.debt} debt marker(s)`);
    for (const fn of f.functions) {
      if (fn.loc > cfg.maxFnLoc)
        push(f.file, fn.startLine, 'fn-size', 'error', fn.loc, cfg.maxFnLoc, `function ${fn.name} too long`);
      if (fn.complexity > cfg.maxComplexity)
        push(f.file, fn.startLine, 'complexity', 'error', fn.complexity, cfg.maxComplexity, `function ${fn.name} too complex`);
      if (fn.nesting > cfg.maxNesting)
        push(f.file, fn.startLine, 'nesting', 'warn', fn.nesting, cfg.maxNesting, `function ${fn.name} nested too deep`);
      if (fn.params > cfg.maxParams)
        push(f.file, fn.startLine, 'params', 'warn', fn.params, cfg.maxParams, `function ${fn.name} has too many params`);
    }
  }

  const duplication = findDuplication(
    inputs.map((x) => ({ file: x.file, code: stripToCode(x.source.split('\n')) })),
    cfg.dupMinLines,
  );
  for (const d of duplication) {
    const o = d.occurrences[0];
    push(
      o.file,
      o.startLine,
      'duplication',
      'warn',
      d.count,
      1,
      `${d.lines}-line block duplicated ${d.count}×`,
    );
  }

  const errors = violations.filter((v) => v.severity === 'error').length;
  const warns = violations.filter((v) => v.severity === 'warn').length;
  const score = Math.max(0, 100 - errors * 5 - warns * 2);
  return { files, functions: fnCount, violations, duplication, errors, warns, score };
}

export function formatQuality(r: QualityReport): string {
  const lines = r.violations
    .slice()
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
    .map((v) => `${v.file}:${v.line}: ${v.severity}: [${v.rule}] ${v.message}`);
  return lines.join('\n');
}
