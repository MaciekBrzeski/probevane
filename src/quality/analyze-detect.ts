// Quality analyzer detection helpers. stripToCode (string/comment/regex/template
// stripping) feeds the line-based metrics (long lines, imports, debt, duplication).
// detectFunctions is AST-based (ts-morph): each function is measured on its OWN body,
// so nested closures/methods are their own nodes and are never absorbed into the
// parent (a line-based brace-matcher can't tell a nested function from a block).
import { Project, Node, SyntaxKind } from 'ts-morph';
import type { FnMetric } from './analyze.js';

// --- string + comment stripping -------------------------------------------

interface StripState {
  inBlock: boolean;
  inTemplate: boolean;
}

/** Advance past a block comment from index `i`; clears state when it closes. */
function skipBlockComment(raw: string, i: number, st: StripState): number {
  const end = raw.indexOf('*/', i);
  if (end === -1) return raw.length;
  st.inBlock = false;
  return end + 2;
}

/** Skip a string literal starting just after its opening quote; returns the
 *  index past the closing quote. */
function skipString(raw: string, i: number, quote: string): number {
  while (i < raw.length && raw[i] !== quote) {
    if (raw[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** Single/double quote — the string openers skipInterp must step over. */
const isQuote = (c: string): boolean => c === '"' || c === "'";

/** Skip a `${ … }` interpolation from just after the `{`; balances braces and
 *  steps over strings + nested templates inside it (so a `}` or backtick within a
 *  string/nested-template doesn't end it early). Returns the index past the `}`. */
function skipInterp(raw: string, i: number): number {
  let depth = 1;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { if (--depth === 0) return i + 1; i++; continue; }
    if (isQuote(c)) { i = skipString(raw, i + 1, c); continue; }
    if (c === '`') { i = skipNestedTemplate(raw, i + 1); continue; }
    i++;
  }
  return i; // interpolation runs past the line (rare) — stop here
}

/** Skip a NESTED template (inside an interpolation), line-local; handles its own
 *  `${ … }` so an inner backtick doesn't mis-close the outer template. */
function skipNestedTemplate(raw: string, i: number): number {
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && raw[i + 1] === '{') { i = skipInterp(raw, i + 2); continue; }
    i++;
  }
  return i;
}

/** Skip template-literal content from index `i` to past the closing unescaped
 *  backtick; sets st.inTemplate when it runs off the line (a multi-line template),
 *  so later lines collapse too. `${ … }` interpolations (incl. nested templates,
 *  e.g. a `${cond ? `inner` : x}` className/styled builder) are stepped over so an
 *  inner backtick can't mis-close the literal. The whole span is collapsed/kept by
 *  the caller — interpolation expressions count as literal text, like single-line
 *  backtick strings already do. */
function skipTemplate(raw: string, i: number, st: StripState): number {
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { st.inTemplate = false; return i + 1; }
    if (c === '$' && raw[i + 1] === '{') { i = skipInterp(raw, i + 2); continue; }
    i++;
  }
  st.inTemplate = true;
  return raw.length;
}

const REGEX_PREV = '([{,;=:!&|?';
const REGEX_KW = /\b(return|typeof|instanceof|in|of|new|delete|void|do|else|yield|await|case)$/;

/** True if a `/` here begins a regex literal (vs division), judged from the code
 *  emitted so far on the line. */
function regexContext(s: string): boolean {
  const t = s.replace(/\s+$/, '');
  if (t === '') return true;
  return REGEX_PREV.includes(t[t.length - 1]!) || REGEX_KW.test(t);
}

/** Skip a regex literal from just after its opening `/`; returns the index past the
 *  closing UNESCAPED `/` (a `/` inside a `[...]` char class does not close it). */
function skipRegex(raw: string, j: number): number {
  let inClass = false;
  while (j < raw.length) {
    const c = raw[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '[') { inClass = true; j++; continue; }
    if (c === ']') { inClass = false; j++; continue; }
    if (c === '/' && !inClass) return j + 1;
    j++;
  }
  return j; // unterminated on this line
}

/** Handle a string/template/comment construct starting at raw[i] (not `//` or a
 *  regex); returns {next index, text to emit} or null for an ordinary character.
 *  Comments are always dropped. With `keep`, string/template literals are emitted
 *  verbatim (so distinct data isn't equated); otherwise they collapse to "". */
function stripConstruct(raw: string, i: number, st: StripState, keep: boolean): { i: number; emit: string } | null {
  if (st.inTemplate) { const n = skipTemplate(raw, i, st); return { i: n, emit: keep ? raw.slice(i, n) : '""' }; }
  if (st.inBlock) return { i: skipBlockComment(raw, i, st), emit: '' };
  if (raw.startsWith('/*', i)) { st.inBlock = true; return { i: i + 2, emit: '' }; }
  const ch = raw[i];
  if (ch === '"' || ch === "'") {
    const n = skipString(raw, i + 1, ch);
    return { i: n, emit: keep ? raw.slice(i, n) : '""' };
  }
  if (ch === '`') { const n = skipTemplate(raw, i + 1, st); return { i: n, emit: keep ? raw.slice(i, n) : '""' }; }
  return null;
}

/** Strip comments (+ collapse strings/regex unless `keep`) from a single line. */
function stripLine(raw: string, st: StripState, keep: boolean): string {
  let s = '';
  let i = 0;
  while (i < raw.length) {
    const step = stripConstruct(raw, i, st, keep);
    if (step) { i = step.i; s += step.emit; continue; }
    if (raw.startsWith('//', i)) break;
    const ch = raw[i];
    if (ch === '/' && regexContext(s)) {
      const n = skipRegex(raw, i + 1);
      s += keep ? raw.slice(i, n) : 'RE'; // collapse the regex literal (no braces/quotes leak)
      i = n;
      continue;
    }
    s += ch;
    i++;
  }
  return s;
}

/** Strip comments + (by default) collapse string/template/regex literals to
 *  code-only lines, so brace/control-flow counting isn't fooled by literal text.
 *  `keepStrings` preserves literal CONTENT (for duplication, so distinct data rows
 *  — e.g. a command table — aren't flattened into identical "" lines). */
export function stripToCode(lines: string[], keepStrings = false): string[] {
  const st: StripState = { inBlock: false, inTemplate: false };
  return lines.map((raw) => stripLine(raw, st, keepStrings));
}

// --- function detection (AST-based, ts-morph) -----------------------------

// Reused across calls: in-memory, no type resolution → fast (~200 files < 1s).
const detectProject = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { allowJs: true, skipLibCheck: true, noResolve: true },
  skipFileDependencyResolution: true,
});

const FN_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration, SyntaxKind.FunctionExpression, SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration, SyntaxKind.Constructor, SyntaxKind.GetAccessor, SyntaxKind.SetAccessor,
]);
// Branch nodes (cyclomatic) — mirrors the old if/for/while/case/catch + && ||.
const BRANCH_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement, SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement, SyntaxKind.DoStatement, SyntaxKind.CaseClause, SyntaxKind.CatchClause,
]);
// Nodes that deepen nesting for their children (cognitive weighting).
const NEST_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement, SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement, SyntaxKind.DoStatement, SyntaxKind.CatchClause, SyntaxKind.SwitchStatement,
]);

/** Any function-shaped node — the boundary at which body measurement stops descending. */
function isFnLike(n: Node): boolean {
  return FN_KINDS.has(n.getKind());
}

/** `&&` / `||` binary — short-circuits are decision points, so they count as branches. */
function isLogicalBinary(n: Node): boolean {
  if (!Node.isBinaryExpression(n)) return false;
  const op = n.getOperatorToken().getKind();
  return op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken;
}

/** Display name: declaration/method name, or the var/property the function is assigned to. */
function fnName(n: Node): string {
  if (Node.isConstructorDeclaration(n)) return 'constructor';
  const named = n as { getName?: () => string | undefined };
  if (typeof named.getName === 'function') {
    const nm = named.getName();
    if (nm) return nm;
  }
  const p = n.getParent();
  if (p && (Node.isVariableDeclaration(p) || Node.isPropertyAssignment(p) || Node.isPropertyDeclaration(p)))
    return p.getName() ?? '(anonymous)';
  return '(anonymous)';
}

/** The function's body when it is a block; expression-body arrows yield undefined (nothing to size). */
function blockBodyOf(n: Node): Node | undefined {
  const b = (n as { getBody?: () => Node | undefined }).getBody?.();
  return b && Node.isBlock(b) ? b : undefined;
}

interface BodyMetrics {
  branches: number;
  cognitive: number;
  nesting: number;
}

/** Count branches/cognitive/nesting in a body, NOT descending into nested functions
 *  (those are reported on their own — the line-based detector wrongly absorbed them). */
function measureBody(body: Node): BodyMetrics {
  let branches = 0;
  let cognitive = 0;
  let nesting = 0;
  const visit = (node: Node, depth: number): void => {
    for (const child of node.getChildren()) {
      if (isFnLike(child)) continue; // nested function — measured separately
      const isBranch = BRANCH_KINDS.has(child.getKind()) || isLogicalBinary(child);
      if (isBranch) {
        branches++;
        cognitive += 1 + depth;
      }
      const deepens = NEST_KINDS.has(child.getKind());
      if (deepens) nesting = Math.max(nesting, depth + 1);
      visit(child, deepens ? depth + 1 : depth);
    }
  };
  visit(body, 0);
  return { branches, cognitive, nesting };
}

/** Reportable: named decls/methods/accessors/ctor, plus block-body arrows/fn-exprs
 *  with a derivable name. Anonymous + expression-body arrows are skipped (too small
 *  to gate, and they would flood the report). */
function isReportable(n: Node): boolean {
  const k = n.getKind();
  if (
    k === SyntaxKind.FunctionDeclaration ||
    k === SyntaxKind.MethodDeclaration ||
    k === SyntaxKind.Constructor ||
    k === SyntaxKind.GetAccessor ||
    k === SyntaxKind.SetAccessor
  )
    return true;
  return (k === SyntaxKind.ArrowFunction || k === SyntaxKind.FunctionExpression) && fnName(n) !== '(anonymous)';
}

/** Does a doc comment precede this node? Arrows/fn-exprs sit inside a variable
 *  statement — the comment belongs to that statement, so judge from the outermost
 *  declaration statement, not the function node itself. */
function hasLeadingDoc(n: Node): boolean {
  const stmt =
    n.getFirstAncestorByKind(SyntaxKind.VariableStatement) ??
    n.getFirstAncestorByKind(SyntaxKind.ExportAssignment) ??
    n;
  return stmt.getLeadingCommentRanges().length > 0;
}

/** Per-function size/complexity metrics via AST. Each function is measured on its
 *  own body; nested functions are separate nodes, never folded into the parent. */
export function detectFunctions(source: string): FnMetric[] {
  const sf = detectProject.createSourceFile('__detect__.tsx', source, { overwrite: true });
  const out: FnMetric[] = [];
  sf.forEachDescendant((node) => {
    if (!isFnLike(node) || !isReportable(node)) return;
    const body = blockBodyOf(node);
    if (!body) return; // expression-body arrow / no block — nothing to size
    const m = measureBody(body);
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    out.push({
      name: fnName(node),
      startLine,
      endLine,
      loc: endLine - startLine + 1,
      params: (node as { getParameters?: () => unknown[] }).getParameters?.().length ?? 0,
      complexity: m.branches + 1,
      cognitive: m.cognitive,
      nesting: m.nesting,
      // Doc gate input: nested functions inherit-exempt (their parent's doc covers
      // the cluster) — only top-level-ish functions are judged, so mark nested ones
      // as documented.
      hasDoc: node.getAncestors().some(isFnLike) ? true : hasLeadingDoc(node),
    });
  });
  return out;
}

/** One interface/type-alias declaration in a file: where it is, whether it's
 *  exported, and whether a shape comment precedes it. Filled by detectTypeDecls;
 *  judged by the type-doc rule. */
export interface TypeDecl {
  name: string;
  line: number;
  exported: boolean;
  hasDoc: boolean;
}

/** Exported interface/type-alias declarations + whether a shape comment precedes
 *  them — input for the type-doc rule (an exported contract should say what its
 *  usual shape/lifecycle is, not just list fields). */
export function detectTypeDecls(source: string): TypeDecl[] {
  const sf = detectProject.createSourceFile('__detect__.tsx', source, { overwrite: true });
  const out: TypeDecl[] = [];
  for (const node of [...sf.getInterfaces(), ...sf.getTypeAliases()]) {
    out.push({
      name: node.getName(),
      line: node.getStartLineNumber(),
      exported: node.isExported(),
      hasDoc: node.getLeadingCommentRanges().length > 0,
    });
  }
  return out;
}
