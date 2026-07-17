import { relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { walk } from '../util/fs.js';
import { detectFunctions } from '../quality/analyze.js';
import { analyzeByFile } from '../quality/euphony.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane euphony <dir>` backend — a playful, report-only ($0, no LLM) read of a
// project's naming MUSIC: each source file's function names scored for rhyme
// (shared rime, exact + slant) and syllabic meter, per file + a pooled overall.
// Same phonetic model the euphony_gate rune uses live (src/quality/euphony.ts).

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.probevane', 'pkg', 'Binaries']);
const SRC = /\.(tsx?|jsx?|mjs)$/;
const TEST = /\.(test|spec|d)\.[tj]sx?$/;

/** Function names per source file under `dir` (tests + generated dirs skipped). */
async function namesByFile(dir: string): Promise<Map<string, string[]>> {
  const files = (await walk(dir, SKIP)).filter((f) => SRC.test(f) && !TEST.test(f));
  const byFile = new Map<string, string[]>();
  for (const f of files) {
    const src = await readFile(f, 'utf8').catch(() => '');
    const names = detectFunctions(src).map((fn) => fn.name).filter((n) => n.length >= 3);
    if (names.length >= 2) byFile.set(relative(dir, f), names);
  }
  return byFile;
}

/** Report per-file + overall function-name euphony for a project directory. */
export async function run(ctx: CommandCtx): Promise<void> {
  const top = Number(ctx.flags.top ?? 5);
  const { files, overall } = analyzeByFile(await namesByFile(ctx.dir));
  if (!overall.count) {
    console.log('euphony: no scorable functions found');
    return;
  }
  const meter = `${overall.meterMean.toFixed(1)}±${overall.meterStdev.toFixed(1)}`;
  console.log(`\n♪ euphony of ${ctx.dir} — ${overall.count} functions across ${files.length} file(s)`);
  console.log(`overall ${overall.score}/100 · density ${(overall.density * 100).toFixed(0)}% · meter ${meter}\n`);
  for (const { file, report } of files) {
    if (report.count < 2) continue;
    const fams = report.families
      .slice(0, top)
      .map((f) => `${f.rime}:${f.names.slice(0, 6).join('/')}`)
      .join('  ');
    console.log(`  ${String(report.score).padStart(3)}/100  ${file}${fams ? `  — ${fams}` : ''}`);
  }
}
