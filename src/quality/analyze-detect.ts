// Function/comment detection helpers for the quality analyzer (Phase 5). Split out
// of analyze.ts to keep each file/function under the project's own quality bar:
// stripToCode (string/comment stripping) and detectFunctions (heuristic, brace-
// matched function detection) plus their small private helpers live here and are
// re-exported by analyze.ts so the public API is unchanged.
import type { FnMetric } from './analyze.js';

const BRANCH = /\b(if|for|while|case|catch)\b|&&|\|\|/g;

// --- string + comment stripping -------------------------------------------

interface StripState {
  inBlock: boolean;
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

/** Strip strings + comments from a single line, advancing block-comment state. */
function stripLine(raw: string, st: StripState): string {
  let s = '';
  let i = 0;
  while (i < raw.length) {
    if (st.inBlock) {
      i = skipBlockComment(raw, i, st);
      continue;
    }
    if (raw.startsWith('//', i)) break;
    if (raw.startsWith('/*', i)) {
      st.inBlock = true;
      i += 2;
      continue;
    }
    const ch = raw[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(raw, i + 1, ch);
      s += '""'; // collapse the literal
      continue;
    }
    s += ch;
    i++;
  }
  return s;
}

/** Strip strings + comments to code-only lines (heuristic; multi-line templates may leak). */
export function stripToCode(lines: string[]): string[] {
  const st: StripState = { inBlock: false };
  return lines.map((raw) => stripLine(raw, st));
}

// --- function detection ----------------------------------------------------

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

/** Match a function/method header on a single code-only line, or null. */
function matchHeader(line: string): { name: string; params: string } | null {
  for (const h of HEADERS) {
    const m = line.match(h.re);
    if (m) return { name: m[h.name] || '(anonymous)', params: m[h.params] ?? '' };
  }
  const m = line.match(METHOD);
  if (m && !KEYWORDS.has(m[1])) return { name: m[1], params: m[2] ?? '' };
  return null;
}

/** True while we're still before the header's opening block and should bail (no
 *  block body found within a few lines / a `;` ended the statement first). */
function noBlockYet(started: boolean, j: number, i: number, t: string): boolean {
  return !started && j > i && (j - i > 3 || /;\s*$/.test(t));
}

/** Tally brace open/close over one line; tracks max nesting depth seen. */
function scanBraces(
  t: string,
  depth: number,
  maxDepth: number,
): { depth: number; maxDepth: number; opened: boolean } {
  let opened = false;
  for (const ch of t) {
    if (ch === '{') {
      depth++;
      opened = true;
      if (depth - 1 > maxDepth) maxDepth = depth - 1;
    } else if (ch === '}') {
      depth--;
    }
  }
  return { depth, maxDepth, opened };
}

interface BodyScan {
  endLine: number;
  branches: number;
  cognitive: number;
  maxDepth: number;
}

/** Brace-match a function body starting at line `i`; null if no block body. The
 *  opening `{` must appear within a few lines of the header and before any `;`. */
function scanBody(code: string[], i: number): BodyScan | null {
  let depth = 0,
    started = false,
    maxDepth = 0,
    branches = 0,
    cognitive = 0;
  let j = i;
  let openFound = false;
  for (; j < code.length; j++) {
    const t = code[j];
    if (noBlockYet(started, j, i, t)) break; // no block here → bail
    const bc = (t.match(BRANCH) || []).length;
    branches += bc;
    // Cognitive cost: each branch costs 1 + its nesting depth (SonarQube-style —
    // depth here = braces open before this line; body top-level = nesting 0).
    cognitive += bc * (1 + Math.max(0, depth - 1));
    const r = scanBraces(t, depth, maxDepth);
    depth = r.depth;
    maxDepth = r.maxDepth;
    if (r.opened) {
      started = true;
      openFound = true;
    }
    if (started && depth <= 0) break;
  }
  if (!openFound) return null; // no block body (expression arrow / declaration)
  return { endLine: Math.min(j, code.length - 1), branches, cognitive, maxDepth };
}

/** Detect non-nested functions in a file (heuristic, brace-matched). */
export function detectFunctions(code: string[]): FnMetric[] {
  const fns: FnMetric[] = [];
  let i = 0;
  while (i < code.length) {
    const hdr = matchHeader(code[i]);
    if (hdr === null) {
      i++;
      continue;
    }
    const body = scanBody(code, i);
    if (body === null) {
      i++;
      continue; // header matched but no block body — skip
    }
    fns.push({
      name: hdr.name,
      startLine: i + 1,
      endLine: body.endLine + 1,
      loc: body.endLine - i + 1,
      params: countParams(hdr.params),
      complexity: body.branches + 1,
      cognitive: body.cognitive,
      nesting: body.maxDepth,
    });
    i = body.endLine + 1; // skip past this function (don't re-detect nested)
  }
  return fns;
}
