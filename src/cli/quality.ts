import { resolve, join, relative } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { analyzeProject, formatQuality, DEFAULT_QUALITY, type QualityConfig } from '../quality/analyze.js';

// probevane quality <dir> [--json] [--strict] [--max-file N] [--max-fn N]
//                        [--max-complexity N] [--max-nesting N] [--max-params N]
//                        [--max-width N] [--max-imports N] [--no-debt]
//
// Project source-quality gate: file size, function length / complexity / nesting /
// params, long lines, debt markers, import fan-out, and duplication. Reports a
// 0–100 health grade. --strict exits 1 on any error-severity violation (CI gate),
// complementing audit (test specs), assert-score (assertions), and bench (mutation).
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.probevane']);
const SRC = /\.(tsx|ts|jsx|js)$/;
const TEST = /\.(test|spec|d)\.[tj]sx?$/;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) out.push(...(await walk(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir).catch(() => ({}) as any);
  const num = (s?: string) => (s !== undefined ? parseInt(s, 10) : undefined);

  // Where to scan: <dir>/src if present, else <dir>.
  const srcRoot = (await stat(join(dir, 'src')).then((s) => s.isDirectory()).catch(() => false))
    ? join(dir, 'src')
    : dir;
  const files = (await walk(srcRoot)).filter((f) => SRC.test(f) && !TEST.test(f));

  if (!files.length) {
    console.log('[probevane] quality: no source files found');
    return;
  }

  const qc: QualityConfig = {
    ...DEFAULT_QUALITY,
    ...(cfg.quality ?? {}),
    ...clean({
      maxFileLoc: num(flag(args, '--max-file')),
      maxFnLoc: num(flag(args, '--max-fn')),
      maxComplexity: num(flag(args, '--max-complexity')),
      maxNesting: num(flag(args, '--max-nesting')),
      maxParams: num(flag(args, '--max-params')),
      maxLineWidth: num(flag(args, '--max-width')),
      maxImports: num(flag(args, '--max-imports')),
    }),
    debt: !args.includes('--no-debt'),
  };

  const inputs = await Promise.all(
    files.map(async (f) => ({ file: relative(dir, f), source: await readFile(f, 'utf8').catch(() => '') })),
  );
  const report = analyzeProject(inputs, qc);

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.violations.length) console.log(formatQuality(report));
    console.log(
      `\n[probevane] quality: ${report.files.length} file(s), ${report.functions} function(s), ` +
        `${report.errors} error(s), ${report.warns} warn(s), ${report.duplication.length} dup block(s), grade ${report.score}/100`,
    );
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
