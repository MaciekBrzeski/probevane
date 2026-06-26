import type { TestTarget } from '../adapters/adapter.js';

// Easy-band triage — decide which targets a small LOCAL model can draft alone
// ($0) vs which need the bridge/paid model. Grounded in the measured local-agent
// ceiling: a 3B emits structurally-clean tests for FOCUSED, LOW-FACT modules but
// INVENTS facts (constant tables, IDs, rates) and chokes on IO/components. So:
// route pure, low-fact, self-contained modules → local; everything else → bridge.

export interface Triage {
  easy: boolean;
  score: number; // higher = harder
  reasons: string[];
}

const NETWORK_IO = /\b(fetch\s*\(|axios|XMLHttpRequest|got\(|child_process|execFile|spawn\(|readFile|writeFile|createReadStream|new Pool|mongoose|prisma)/;
// Real component/UI markers — NOT `<Capital>` (that false-positives on TS generics
// like Map<Entry>); JSX components are caught by the .tsx/.jsx/.vue/.svelte ext.
const COMPONENT = /\buseState\b|\buseEffect\b|\brender\s*\(|\bmount\s*\(|TestBed|@vue\/|@angular|@testing-library/;
const CLASSY = /\bclass\s+\w+/;
const ASYNC = /\basync\b|Promise<|await\b/;

/** Count literal facts (quoted strings + numeric literals) — a constant/rate table
 *  scores high; a pure `add(a,b)` scores ~0. High fact density = local mis-binds. */
export function factDensity(source: string): number {
  const strings = (source.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? []).filter((s) => s.length > 3).length;
  const nums = (source.match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? []).length;
  return strings + nums;
}

/**
 * Is this target safe to draft with a small LOCAL model alone?
 * Pure + self-contained + low-fact → yes; IO/component/class/fact-heavy/big → no.
 */
export function isEasyTarget(
  target: TestTarget,
  source: string,
  opts: { maxLines?: number; maxFacts?: number; maxImports?: number } = {},
): Triage {
  const maxLines = opts.maxLines ?? 80;
  const maxFacts = opts.maxFacts ?? 10;
  const maxImports = opts.maxImports ?? 6;
  const reasons: string[] = [];
  let score = 0;

  const lines = source.split('\n').length;
  const imports = (source.match(/^\s*import\b/gm) ?? []).length;
  const facts = factDensity(source);

  if (NETWORK_IO.test(source)) { score += 5; reasons.push('network/IO'); }
  if (COMPONENT.test(source) || /\.(tsx|jsx|vue|svelte)$/.test(target.sourcePath)) { score += 4; reasons.push('component/UI'); }
  if (CLASSY.test(source)) { score += 2; reasons.push('class/stateful'); }
  if (ASYNC.test(source)) { score += 1; reasons.push('async'); }
  if (lines > maxLines) { score += 2; reasons.push(`large (${lines} lines)`); }
  if (facts > maxFacts) { score += 2; reasons.push(`fact-heavy (${facts} literals)`); }
  if (imports > maxImports) { score += 1; reasons.push(`${imports} imports`); }
  if (Number((target.meta as any)?.cost ?? 0) >= 5) { score += 3; reasons.push('provider-heavy'); }
  // Interface/type-only modules have no runtime code to assert — not a useful (or
  // landable) test target.
  if (!/export\s+(async\s+)?(function|const|class|default)\b/.test(source)) { score += 5; reasons.push('types-only (no runtime exports)'); }

  return { easy: score === 0, score, reasons: reasons.length ? reasons : ['pure, low-fact, self-contained'] };
}

/** Split targets into local-draftable (easy) vs bridge-needed (hard) by their source. */
export function routeTargets(
  pairs: Array<{ target: TestTarget; source: string }>,
): { easy: TestTarget[]; hard: TestTarget[] } {
  const easy: TestTarget[] = [];
  const hard: TestTarget[] = [];
  for (const { target, source } of pairs) (isEasyTarget(target, source).easy ? easy : hard).push(target);
  return { easy, hard };
}
