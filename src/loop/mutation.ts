import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import type { StackAdapter } from '../adapters/adapter.js';
import { buildGraph } from '../mock/graph.js';
import { stripToCode } from '../quality/analyze-detect.js';

// Shared mutation tester — mutate a few source operators and check the suite
// fails (kills the mutant). Used by mutation_gate (enforce) and bench (report).
export const MUTATIONS: [RegExp, string][] = [
  [/===/g, '!=='],
  [/!==/g, '==='],
  [/>=/g, '<'],
  [/<=/g, '>'],
  [/&&/g, '||'],
  [/\btrue\b/g, 'false'],
  [/\+/g, '-'],
];

export interface MutationResult {
  total: number;
  killed: number;
  score: number; // killed/total (1 if none applicable)
  budgetHit?: boolean; // true if the wall-budget cut the run short (partial score)
}

/** A mutant the current suite does NOT catch — the actionable signal for
 *  mutation-driven generation: write a test that fails when this is applied. */
export interface SurvivingMutant {
  sourcePath: string;
  line: number;
  mutation: string; // "=== → !=="
  snippet: string; // the source line, trimmed
}

/** 1-based line number of a character index in `src`. */
export function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

/** Shared context for evaluating one mutation against one target file. */
interface MutantCtx {
  dir: string;
  adapter: StackAdapter;
  abs: string;
  original: string;
  sourcePath: string;
}

/** Build the per-target mutation context; null when the source can't be read. */
async function targetCtx(dir: string, adapter: StackAdapter, sourcePath: string): Promise<MutantCtx | null> {
  const abs = join(dir, sourcePath);
  const original = await readFile(abs, 'utf8').catch(() => '');
  if (!original) return null;
  return { dir, adapter, abs, original, sourcePath };
}

/** Apply one mutation; return the surviving mutant (suite stayed GREEN) or null. */
async function trySurvivor(c: MutantCtx, re: RegExp, repl: string): Promise<SurvivingMutant | null> {
  re.lastIndex = 0;
  const m = re.exec(c.original);
  if (!m) return null;
  const mutated = c.original.slice(0, m.index) + repl + c.original.slice(m.index + m[0].length);
  if (mutated === c.original) return null;
  try {
    await writeFile(c.abs, mutated);
    const run = await c.adapter.run(c.dir, 'unit');
    if (!run.green) return null;
    const line = lineOf(c.original, m.index);
    return {
      sourcePath: c.sourcePath,
      line,
      mutation: `${m[0]} → ${repl}`,
      snippet: (c.original.split('\n')[line - 1] ?? '').trim().slice(0, 90),
    };
  } finally {
    await writeFile(c.abs, c.original);
  }
}

/** Mutation-driven steering: apply one mutation at a time; a mutant that leaves
 *  the suite GREEN survived — collect it with its location. */
export async function survivingMutants(
  dir: string,
  adapter: StackAdapter,
  maxMutants = 6,
  maxTargets = 3,
): Promise<SurvivingMutant[]> {
  const out: SurvivingMutant[] = [];
  const targets = (await adapter.discover(dir, 'unit')).slice(0, maxTargets);
  for (const t of targets) {
    const ctx = await targetCtx(dir, adapter, t.sourcePath);
    if (!ctx) continue;
    for (const [re, repl] of MUTATIONS) {
      if (out.length >= maxMutants) break;
      const s = await trySurvivor(ctx, re, repl);
      if (s) out.push(s);
    }
  }
  return out;
}

/** Prompt block steering generation at the surviving mutants. */
export function mutantDigest(survivors: SurvivingMutant[]): string {
  if (!survivors.length) return '';
  return (
    'SURVIVING MUTANTS — the current tests do NOT catch these. Add a test that FAILS when each mutation is applied (assert the exact behavior the mutation breaks):\n' +
    survivors.map((m) => `- ${m.sourcePath}:${m.line}  \`${m.mutation}\`  in: ${m.snippet}`).join('\n')
  );
}

/** Apply one mutation; null = not applicable, true = killed (suite went red), false = survived. */
async function scoreMutant(c: MutantCtx, re: RegExp, repl: string): Promise<boolean | null> {
  re.lastIndex = 0; // MUTATIONS are shared module-level /g regexes — reset before
  if (!re.test(c.original)) return null; // .test() (it honors a stale lastIndex)
  const mutated = c.original.replace(re, repl);
  if (mutated === c.original) return null;
  try {
    await writeFile(c.abs, mutated);
    const run = await c.adapter.run(c.dir, 'unit');
    return !run.green; // killed if the suite went red
  } finally {
    await writeFile(c.abs, c.original);
  }
}

// --- full per-site mutation run (the `mutation` command) --------------------

export interface MutantSite {
  file: string;
  line: number;
  index: number; // char offset in the file
  op: string;
  repl: string;
  snippet: string;
}
export interface MutantOutcome extends MutantSite {
  status: 'killed' | 'survived';
}
export interface MutationRun {
  total: number;
  killed: number;
  survived: number;
  score: number;
  survivors: MutantOutcome[];
  byFile: Record<string, { total: number; killed: number }>;
  sampled: boolean; // true if budget capped the site list
}

/** Every real-code mutation site in a source file (operators inside strings/
 *  comments are skipped — a line is eligible only if the operator survives
 *  stripToCode). */
export function sitesIn(file: string, src: string): MutantSite[] {
  const lines = src.split('\n');
  const code = stripToCode(lines);
  const sites: MutantSite[] = [];
  let offset = 0;
  lines.forEach((raw, i) => {
    for (const [re, repl] of MUTATIONS) {
      if (new RegExp(re.source).test(code[i] ?? '')) {
        for (const m of raw.matchAll(new RegExp(re.source, 'g')))
          sites.push({ file, line: i + 1, index: offset + m.index!, op: m[0], repl, snippet: raw.trim().slice(0, 90) });
      }
    }
    offset += raw.length + 1; // + newline
  });
  return sites;
}

/** Down-sample to `budget` sites, spread evenly across the list (deterministic). */
function sampleSites(sites: MutantSite[], budget: number): MutantSite[] {
  if (sites.length <= budget) return sites;
  const stride = sites.length / budget;
  return Array.from({ length: budget }, (_, i) => sites[Math.floor(i * stride)]);
}

// Glue with no unit tests (spawn/process/network/browser/CLI) — mutating it only
// yields survivors that drag the score, so by default mutation mirrors coverage
// and skips it. `--all` (opts.all) mutates everything.
const GLUE = /(^|\/)(cli\/|.*\.d\.ts$)|\/(run|install)\.ts$|brain\/(anthropic-sdk|openai-compat|bridge|claude-code)|visual\/(capture|vision|improve)|loop\/(run-generation|run-path|run-docs|delegate|draft-local)|factory\/run|quality\/scan|mfe\/(scan|driver|contract-scan)|ship\/ship|distill\/collect|e2e\//;

/** Full mutation run: mutate each site one at a time, rerun the suite, and record
 *  killed (suite went red) vs survived. `budget` caps the number of mutants; by
 *  default untested glue is skipped (pass `all` to include it). */
export async function runMutation(
  dir: string,
  adapter: StackAdapter,
  opts: { files?: string[]; budget?: number; all?: boolean; log?: (l: string) => void } = {},
): Promise<MutationRun> {
  const log = opts.log ?? (() => {});
  const graphFiles = opts.files ?? (await buildGraph(dir)).order;
  const files = opts.all ? graphFiles : graphFiles.filter((f) => !GLUE.test(f));
  const all: MutantSite[] = [];
  for (const f of files) {
    const src = await readFile(join(dir, f), 'utf8').catch(() => '');
    if (src) all.push(...sitesIn(f, src));
  }
  const budget = opts.budget ?? 50;
  const sites = sampleSites(all, budget);
  log(`[mutation] ${all.length} sites, running ${sites.length}${all.length > sites.length ? ` (budget ${budget})` : ''}`);

  // Restore the in-flight mutant if interrupted (Ctrl-C / kill) — a mutation tool
  // must never leave a mutated source file behind. (SIGKILL can't be caught.)
  const restorer = new MutantRestorer();
  const onSig = () => { restorer.restore(); process.exit(130); };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  const survivors: MutantOutcome[] = [];
  const byFile: Record<string, { total: number; killed: number }> = {};
  let killed = 0;
  try {
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const outcome = await runOneSite(dir, adapter, s, restorer);
      (byFile[s.file] ??= { total: 0, killed: 0 }).total++;
      if (outcome === 'killed') { killed++; byFile[s.file].killed++; }
      else survivors.push({ ...s, status: 'survived' });
      if ((i + 1) % 10 === 0) log(`[mutation] ${i + 1}/${sites.length} (${killed} killed)`);
    }
  } finally {
    restorer.restore();
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
  }
  const total = sites.length;
  const score = total ? killed / total : 1;
  return { total, killed, survived: total - killed, score, survivors, byFile, sampled: all.length > sites.length };
}

/** Remembers the one mutated file in flight so an interrupt handler can restore it
 *  synchronously (the async try/finally handles the normal path). */
class MutantRestorer {
  private active: { abs: string; original: string } | null = null;
  arm(abs: string, original: string): void { this.active = { abs, original }; }
  clear(): void { this.active = null; }
  restore(): void {
    if (!this.active) return;
    try { writeFileSync(this.active.abs, this.active.original); } catch { /* best-effort */ }
    this.active = null;
  }
}

/** Apply one site's mutation, rerun the suite, restore. 'killed' = suite went red. */
async function runOneSite(
  dir: string,
  adapter: StackAdapter,
  s: MutantSite,
  restorer: MutantRestorer,
): Promise<'killed' | 'survived'> {
  const abs = join(dir, s.file);
  const original = await readFile(abs, 'utf8').catch(() => '');
  if (!original) return 'killed'; // unreadable — treat as no survivor
  const mutated = original.slice(0, s.index) + s.repl + original.slice(s.index + s.op.length);
  restorer.arm(abs, original);
  try {
    await writeFile(abs, mutated);
    const run = await adapter.run(dir, 'unit');
    return run.green ? 'survived' : 'killed';
  } finally {
    await writeFile(abs, original);
    restorer.clear();
  }
}

export async function mutationScore(
  dir: string,
  adapter: StackAdapter,
  maxMutants = 5,
  maxTargets = 3,
  opts: { budgetMs?: number; scope?: string[] } = {},
): Promise<MutationResult> {
  let targets = await adapter.discover(dir, 'unit');
  // Scope: prefer targets whose source matches a file the run just tested, so we
  // mutate what THIS run covered rather than arbitrary discover-first-N. Clean
  // fallback to all targets when nothing matches (heuristic, never fails closed).
  if (opts.scope?.length) {
    const want = new Set(opts.scope.map(sourceStem));
    const hit = targets.filter((t) => want.has(sourceStem(t.sourcePath)));
    if (hit.length) targets = hit;
  }
  targets = targets.slice(0, maxTargets);
  const deadline = opts.budgetMs != null ? Date.now() + opts.budgetMs : Infinity;
  let total = 0;
  let killed = 0;
  let budgetHit = false;
  for (const t of targets) {
    const ctx = await targetCtx(dir, adapter, t.sourcePath);
    if (!ctx) continue;
    for (const [re, repl] of MUTATIONS) {
      if (total >= maxMutants) break;
      // Wall-budget: each mutant re-runs the suite. If we're out of time, stop and
      // flag it — the gate treats a budget-truncated run as advisory (never a false
      // block, never a CI deadlock).
      if (Date.now() >= deadline) { budgetHit = true; break; }
      const result = await scoreMutant(ctx, re, repl);
      if (result === null) continue;
      total++;
      if (result) killed++;
    }
    if (budgetHit) break;
  }
  // Only surface budgetHit when true — keeps the common result shape stable for
  // callers that deep-equal it.
  return { total, killed, score: total ? killed / total : 1, ...(budgetHit ? { budgetHit } : {}) };
}

/** Filename stem (no dir, no extension, no .test/.spec) — for matching a test
 *  file back to the source it covers. `src/format.test.ts` → `format`. */
function sourceStem(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(test|spec)\./, '.').replace(/\.[^.]+$/, '');
}
