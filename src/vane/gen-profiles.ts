import type { ProfileDecl, SegmentLine } from './ast.js';
import { loadProfiles } from './load.js';

// profiles.vane → src/loop/profiles.gen.ts source text. The tables here are
// CLOSED on purpose: every token must resolve or generation fails with
// file:line — Vane grows by adding table entries, never by growing expressions.

/** Scope-expression tokens → the TS expression the builders receive. */
const SCOPE_EXPR: Record<string, string> = { scope: 'scope', unit: "'unit'", e2e: "'e2e'" };
/** Kind-expression tokens for preamble's first argument. */
const KIND_EXPR: Record<string, string> = { kind: 'opts.kind', unit: "'unit'", e2e: "'e2e'" };
/** safety-net rune constructors. */
const RUNE_TABLE: Record<string, string> = { behavior_lock: 'behaviorLock()' };
/** acceptance(...) argument names → ProfileOpts fields. */
const ACCEPT_FIELDS = new Set(['minTests', 'minCoverage', 'shellChecks']);

/** Fail generation with the segment's position. */
function bail(s: SegmentLine, msg: string): never {
  throw new Error(`${s.pos.file}:${s.pos.line}: ${msg}`);
}

/** `acceptance(scope, minTests ?? 1, …)` → the AcceptanceOpts object literal. */
function acceptanceExpr(s: SegmentLine, argsRaw: string): string {
  const parts = argsRaw.split(',').map((a) => a.trim()).filter(Boolean);
  const fields: string[] = [];
  for (const [i, part] of parts.entries()) {
    if (i === 0) {
      const scope = SCOPE_EXPR[part] ?? bail(s, `acceptance: unknown scope '${part}'`);
      fields.push(scope === 'scope' ? 'scope' : `scope: ${scope}`);
      continue;
    }
    const m = part.match(/^(\w+)(?:\s*\?\?\s*(\S+))?$/);
    if (!m || !ACCEPT_FIELDS.has(m[1])) bail(s, `acceptance: unknown field '${part}'`);
    fields.push(m[2] ? `${m[1]}: opts.${m[1]} ?? ${m[2]}` : `${m[1]}: opts.${m[1]}`);
  }
  return `{ ${fields.join(', ')} }`;
}

/** One segment line → its `seg(…)` (or conditional spread) expression. */
function segmentExpr(s: SegmentLine): string {
  const expr = coreSegmentExpr(s);
  return s.cond ? `...(opts.${s.cond} ? [${expr}] : [])` : expr;
}

/** The unconditional part of a segment expression, by segment id. */
function coreSegmentExpr(s: SegmentLine): string {
  if (s.id === 'preamble') {
    const kind = KIND_EXPR[s.tokens[0]] ?? bail(s, `preamble: unknown kind '${s.tokens[0]}'`);
    const flags = s.tokens.slice(1).map((t) => {
      if (t !== 'redFirst' && t !== 'noRegression') bail(s, `preamble: unknown option '${t}'`);
      return `${t}: true`;
    });
    const o = flags.length ? `, { ${flags.join(', ')} }` : '';
    return `seg('preamble', preamble(${kind}${o}))`;
  }
  if (s.id === 'green-gates') return greenGatesExpr(s);
  if (s.id === 'safety-net') {
    const runes = s.tokens.map((t) => RUNE_TABLE[t] ?? bail(s, `safety-net: unknown rune '${t}'`));
    return `seg('safety-net', [${runes.join(', ')}])`;
  }
  if (s.id === 'opt-in') {
    const scope = SCOPE_EXPR[s.tokens[0]] ?? bail(s, `opt-in: unknown scope '${s.tokens[0]}'`);
    const flags = s.tokens.slice(1).map((t) => {
      if (t !== 'extras' && t !== 'mfe') bail(s, `opt-in: unknown option '${t}'`);
      return `${t}: true`;
    });
    return `seg('opt-in', optInGates(opts, ${scope}, { ${flags.join(', ')} }))`;
  }
  if (s.id === 'harvest') {
    if (s.tokens.length && s.tokens[0] !== 'full') bail(s, `harvest: unknown option '${s.tokens[0]}'`);
    return `seg('harvest', harvest(${s.tokens[0] === 'full' ? '{ full: true }' : ''}))`;
  }
  bail(s, `unknown segment '${s.id}'`);
}

/** green-gates: `render_gate(x)` special form, else scope + fullSuite/acceptance. */
function greenGatesExpr(s: SegmentLine): string {
  const renderM = s.tokens[0]?.match(/^render_gate\((\w+)\)$/);
  if (renderM) return `seg('green-gates', [renderGate(opts.${renderM[1]}!)])`;
  const scope = SCOPE_EXPR[s.tokens[0]] ?? bail(s, `green-gates: unknown scope '${s.tokens[0]}'`);
  const rest = s.tokens.slice(1).join(' ');
  if (!rest) return `seg('green-gates', greenGates(${scope}))`;
  if (rest === 'fullSuite') return `seg('green-gates', greenGates(${scope}, { fullSuite: true }))`;
  const acc = rest.match(/^acceptance\((.*)\)$/);
  if (!acc) bail(s, `green-gates: unknown option '${rest}'`);
  return `seg('green-gates', greenGates(${scope}, { acceptance: ${acceptanceExpr(s, acc[1])} }))`;
}

/** One profile → its named builder const (params trimmed to what's used).
 *  Usage detection must not miscount: `scope:` is an object KEY (`{ scope: 'unit' }`),
 *  only bare `scope` (incl. the `{ scope, … }` shorthand) is a parameter use;
 *  `opts` counts with or without a member access (`optInGates(opts, …)`). */
function builderSource(p: ProfileDecl): string {
  const body = p.segments.map((s) => `  ${segmentExpr(s)},`).join('\n');
  const usesScope = /\bscope\b(?!\s*:)/.test(body);
  const usesOpts = /\bopts\b/.test(body);
  const params = usesScope ? '(opts: ProfileOpts, scope: RunScope)' : usesOpts ? '(opts: ProfileOpts)' : '()';
  if (!p.segments.length) return `const ${p.name} = ${params}: Segment[] => [];`;
  return `const ${p.name} = ${params}: Segment[] => [\n${body}\n];`;
}

/** Generate the full profiles.gen.ts source from vane/profiles.vane. */
export function generateProfiles(): string {
  const { profiles, aliases } = loadProfiles();
  const builders = profiles.map(builderSource).join('\n\n');
  const entries = [
    ...profiles.map((p) => p.name),
    ...aliases.map((a) => `${a.name}: ${a.target}`),
  ].join(', ');
  return `// @generated FROM vane/profiles.vane — do not edit. Regenerate: probevane vane --write
import type { RunScope } from '../adapters/adapter.js';
import type { ProfileName, ProfileOpts, Segment } from './profile-types.js';
import { seg, preamble, greenGates, optInGates, harvest } from './profile-subs.js';
import { behaviorLock, renderGate } from './runes/index.js';

${builders}

export const SEGMENT_BUILDERS: Record<ProfileName, (opts: ProfileOpts, scope: RunScope) => Segment[]> = {
  ${entries},
};
`;
}
