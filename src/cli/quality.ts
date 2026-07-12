import { loadConfig } from '../util/config.js';
import { formatQuality, DEFAULT_QUALITY, type QualityConfig, type QualityReport } from '../quality/analyze.js';
import { scanProject } from '../quality/scan.js';
import { changedFiles, isSourceFile } from '../util/git.js';
import { writeBaseline, applyBaseline } from '../quality/baseline.js';
import { toSarif } from '../quality/sarif.js';
import { flag, dirArg } from '../util/args.js';

// probevane quality <dir> [--json] [--strict] [--max-file N] [--max-fn N]
//                        [--max-complexity N] [--max-cognitive N] [--max-nesting N]
//                        [--max-params N] [--max-width N] [--max-imports N] [--no-debt]
//
// Project source-quality gate: file size, function length / cyclomatic + cognitive
// complexity / nesting / params, long lines, debt markers, import fan-out, and
// duplication. Reports a 0–100 health grade. --strict exits 1 on any error-severity
// violation (CI gate), complementing audit (test specs), assert-score, bench.

// Parse + validate a numeric flag: a present-but-bad value (NaN / ≤0) is a hard
// error, not a silent pass-through that would weaken the gate.
function parseNum(args: string[], name: string): number | undefined {
  const s = flag(args, name);
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[probevane] quality: ${name} must be a positive integer (got "${s}")`);
    process.exit(2);
  }
  return n;
}

function buildConfig(args: string[], cfg: any): QualityConfig {
  return {
    ...DEFAULT_QUALITY,
    ...(cfg.quality ?? {}),
    ...clean({
      maxFileLoc: parseNum(args, '--max-file'),
      maxFnLoc: parseNum(args, '--max-fn'),
      maxComplexity: parseNum(args, '--max-complexity'),
      maxCognitive: parseNum(args, '--max-cognitive'),
      maxNesting: parseNum(args, '--max-nesting'),
      maxParams: parseNum(args, '--max-params'),
      maxLineWidth: parseNum(args, '--max-width'),
      maxImports: parseNum(args, '--max-imports'),
    }),
    debt: !args.includes('--no-debt'),
  };
}

function printReport(args: string[], report: QualityReport): void {
  if (args.includes('--json')) {
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

async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const cfg = await loadConfig(dir).catch(() => ({}) as any);
  const qc = buildConfig(args, cfg);

  // --write-baseline always captures the FULL project (a baseline built from only
  // the --since subset would under-capture); --since narrows a normal run.
  const writing = args.includes('--write-baseline');
  const only = writing ? undefined : await changedSince(dir, args);
  let report = await scanProject(dir, qc, only);

  if (!report.files.length) {
    console.log('[probevane] quality: no source files found');
    return;
  }

  if (writing) {
    console.log(`[probevane] quality: wrote baseline (${writeBaseline(dir, report)})`);
    return;
  }

  if (!args.includes('--no-baseline')) report = applyBaseline(dir, report);

  if (args.includes('--sarif')) console.log(JSON.stringify(toSarif(report), null, 2));
  else printReport(args, report);

  // --strict fails CI on any error-severity violation, regardless of output format.
  if (args.includes('--strict') && report.errors > 0) process.exit(1);
}

/** Source files changed since a ref (`--since`), or undefined for a full scan. */
async function changedSince(dir: string, args: string[]): Promise<string[] | undefined> {
  const ref = flag(args, '--since');
  if (ref === undefined) return undefined;
  return (await changedFiles(dir, ref)).filter(isSourceFile);
}

function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
