// Surgical fact-RAG — extract ONLY the literal facts a test must bind (exported
// constant values + type/interface shapes), not the whole source. The measured
// failure: a small model invents IDs/rates/type-shapes; injecting whole source
// BACKFIRED (length choke). This is the targeted middle: the data tables + the
// shapes, compact. Pure + testable.

/** Advance the in-string scanner state by one char while inside a string literal. */
function nextStrState(c: string, inStr: string, esc: boolean): { inStr: string | false; esc: boolean } {
  if (esc) return { inStr, esc: false };
  if (c === '\\') return { inStr, esc: true };
  if (c === inStr) return { inStr: false, esc: false };
  return { inStr, esc: false };
}

/** Is this char a string-literal opener? (all three JS quote kinds). */
function isQuote(c: string): boolean {
  return c === '"' || c === "'" || c === '`';
}

/** From an opening { or [ at `start`, return the balanced literal (string-aware). */
function balanced(s: string, start: number): string {
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr: string | false = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      ({ inStr, esc } = nextStrState(c, inStr, esc));
      continue;
    }
    if (isQuote(c)) { inStr = c; continue; }
    if (c === open) { depth++; continue; }
    if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}

/**
 * Compact digest of the FACTS in a module: exported const values (data tables,
 * IDs, rates) + exported interface/type shapes. Caps each item + the total so it
 * never grows into the length that chokes a small model.
 */
export function factDigest(source: string, opts: { cap?: number; perItem?: number } = {}): string {
  const cap = opts.cap ?? 1600;
  const perItem = opts.perItem ?? 500;
  const out: string[] = [];

  // exported const X (: T)? = <literal>
  const constRe = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = constRe.exec(source))) {
    const vstart = constRe.lastIndex;
    const ch = source[vstart];
    const val = ch === '{' || ch === '[' ? balanced(source, vstart) : (source.slice(vstart).match(/^[^\n;]+/)?.[0] ?? '');
    if (val.trim()) out.push(`export const ${m[1]} = ${val.trim().slice(0, perItem)}`);
  }

  // exported interface/type shapes
  for (const im of source.matchAll(/export\s+(?:interface|type)\s+\w+[^\n{=]*[{]/g)) {
    const braceIdx = (im.index ?? 0) + im[0].length - 1;
    const body = balanced(source, braceIdx);
    out.push((im[0].slice(0, -1) + body).slice(0, perItem));
  }

  return out.join('\n').slice(0, cap);
}
