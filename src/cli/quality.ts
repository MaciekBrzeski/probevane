import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { formatQuality, DEFAULT_QUALITY, type QualityConfig } from '../quality/analyze.js';
import { scanProject } from '../quality/scan.js';

// probevane quality <dir> [--json] [--strict] [--max-file N] [--max-fn N]
//                        [--max-complexity N] [--max-cognitive N] [--max-nesting N]
//                        [--max-params N] [--max-width N] [--max-imports N] [--no-debt]
//
// Project source-quality gate: file size, function length / cyclomatic + cognitive
// complexity / nesting / params, long lines, debt markers, import fan-out, and
// duplication. Reports a 0–100 health grade. --strict exits 1 on any error-severity
// violation (CI gate), complementing audit (test specs), assert-score, bench.

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir).catch(() => ({}) as any);
  // Parse + validate a numeric flag: a present-but-bad value (NaN / ≤0) is a hard
  // error, not a silent pass-through that would weaken the gate.
  const num = (name: string): number | undefined => {
    const s = flag(args, name);
    if (s === undefined) return undefined;
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`[probevane] quality: ${name} must be a positive integer (got "${s}")`);
      process.exit(2);
    }
    return n;
  };

  const qc: QualityConfig = {
    ...DEFAULT_QUALITY,
    ...(cfg.quality ?? {}),
    ...clean({
      maxFileLoc: num('--max-file'),
      maxFnLoc: num('--max-fn'),
      maxComplexity: num('--max-complexity'),
      maxCognitive: num('--max-cognitive'),
      maxNesting: num('--max-nesting'),
      maxParams: num('--max-params'),
      maxLineWidth: num('--max-width'),
      maxImports: num('--max-imports'),
    }),
    debt: !args.includes('--no-debt'),
  };

  const report = await scanProject(dir, qc);

  if (!report.files.length) {
    console.log('[probevane] quality: no source files found');
    return;
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.violations.length) console.log(formatQuality(report));
    console.log(
      `\n[probevane] quality: ${report.files.length} file(s), ${report.functions} function(s), ` +
        `${report.errors} error(s), ${report.warns} warn(s), ` +
        `${report.duplication.length}${report.duplicationCapped ? '+' : ''} dup block(s), grade ${report.score}/100`,
    );
    if (report.duplicationCapped) console.error('[probevane] quality: duplicate-block report capped — more exist.');
  }

  if (args.includes('--strict') && report.errors > 0) process.exit(1);
}

function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
