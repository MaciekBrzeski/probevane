import { loadConfig } from '../util/config.js';
import { formatQuality, DEFAULT_QUALITY, type QualityConfig, type QualityReport } from '../quality/analyze.js';
import { scanProject } from '../quality/scan.js';
import { changedFiles, isSourceFile } from '../util/git.js';
import { writeBaseline, applyBaseline } from '../quality/baseline.js';
import { toSarif } from '../quality/sarif.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane quality` backend — project source-quality gate: file size,
// function length / cyclomatic + cognitive complexity / nesting / params,
// long lines, debt markers, import fan-out, duplication, doc coverage → a
// 0–100 health grade. --strict exits 1 on any error-severity violation (CI),
// complementing audit (test specs), assert-score, bench. Logic moved verbatim
// from the old src/cli/quality.ts shell; the vane interpreter owns argv. The
// threshold flags stay spec-type `str` so parseNum keeps its own semantics: a
// present-but-BAD value is a hard exit 2, not a silent pass that would weaken
// the gate (vane's int type would quietly drop it).

// Parse + validate a numeric flag: a present-but-bad value (NaN / ≤0) is a hard
// error, not a silent pass-through that would weaken the gate.
function parseNum(flags: CommandCtx['flags'], name: string): number | undefined {
  const s = flags[name.slice(2)] as string | undefined;
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[probevane] quality: ${name} must be a positive integer (got "${s}")`);
    process.exit(2);
  }
  return n;
}

// Effective thresholds: defaults < probevane.config quality < explicit flags —
// clean() drops unset flags so they can never shadow config values.
function buildConfig(ctx: CommandCtx, cfg: any): QualityConfig {
  return {
    ...DEFAULT_QUALITY,
    ...(cfg.quality ?? {}),
    ...clean({
      maxFileLoc: parseNum(ctx.flags, '--max-file'),
      maxFnLoc: parseNum(ctx.flags, '--max-fn'),
      maxComplexity: parseNum(ctx.flags, '--max-complexity'),
      maxCognitive: parseNum(ctx.flags, '--max-cognitive'),
      maxNesting: parseNum(ctx.flags, '--max-nesting'),
      maxParams: parseNum(ctx.flags, '--max-params'),
      maxLineWidth: parseNum(ctx.flags, '--max-width'),
      maxImports: parseNum(ctx.flags, '--max-imports'),
    }),
    debt: ctx.flags['no-debt'] !== true,
    requireDocs: ctx.flags['no-docs'] !== true,
  };
}

/** Human (or --json) report: violations, counts, dup blocks, and the 0-100 grade. */
function printReport(ctx: CommandCtx, report: QualityReport): void {
  if (ctx.flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (report.violations.length) console.log(formatQuality(report));
  console.log(
    `\n[probevane] quality: ${report.files.length} file(s), ${report.functions} function(s), ` +
      `${report.errors} error(s), ${report.warns} warn(s), ` +
      `${report.duplication.length}${report.duplicationCapped ? '+' : ''} dup block(s), grade ${report.score}/100`,
  );
  if (report.duplicationCapped) console.error('[probevane] quality: duplicate-block report capped — more exist.');
}

/** Scan ctx.dir (full or --since subset), apply the baseline ratchet unless
 *  --no-baseline, emit report/SARIF; --strict exits 1 on error-severity violations. */
export async function run(ctx: CommandCtx): Promise<void> {
  const dir = ctx.dir;
  const cfg = await loadConfig(dir).catch(() => ({}) as any);
  const qc = buildConfig(ctx, cfg);

  // --write-baseline always captures the FULL project (a baseline built from only
  // the --since subset would under-capture); --since narrows a normal run.
  const writing = ctx.flags['write-baseline'] === true;
  const only = writing ? undefined : await changedSince(dir, ctx.flags.since as string | undefined);
  let report = await scanProject(dir, qc, only);

  if (!report.files.length) {
    console.log('[probevane] quality: no source files found');
    return;
  }

  if (writing) {
    console.log(`[probevane] quality: wrote baseline (${writeBaseline(dir, report)})`);
    return;
  }

  if (ctx.flags['no-baseline'] !== true) report = applyBaseline(dir, report);

  if (ctx.flags.sarif === true) console.log(JSON.stringify(toSarif(report), null, 2));
  else printReport(ctx, report);

  // --strict fails CI on any error-severity violation, regardless of output format.
  if (ctx.flags.strict === true && report.errors > 0) process.exit(1);
}

/** Source files changed since a ref (`--since`), or undefined for a full scan. */
async function changedSince(dir: string, ref: string | undefined): Promise<string[] | undefined> {
  if (ref === undefined) return undefined;
  return (await changedFiles(dir, ref)).filter(isSourceFile);
}

/** Drop undefined entries so unset flags never override config/default values. */
function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
