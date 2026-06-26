import { join, relative } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { analyzeProject, DEFAULT_QUALITY, type QualityConfig, type QualityReport } from './analyze.js';

// I/O wrapper around the pure analyzer: walk a project's source tree, read the
// files, and analyze. Shared by the `quality` CLI and the daemon's /quality.
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

export async function scanProject(
  dir: string,
  cfg: QualityConfig = DEFAULT_QUALITY,
): Promise<QualityReport> {
  const srcRoot = (await stat(join(dir, 'src')).then((s) => s.isDirectory()).catch(() => false))
    ? join(dir, 'src')
    : dir;
  const files = (await walk(srcRoot)).filter((f) => SRC.test(f) && !TEST.test(f));
  const inputs = await Promise.all(
    files.map(async (f) => ({ file: relative(dir, f), source: await readFile(f, 'utf8').catch(() => '') })),
  );
  return analyzeProject(inputs, cfg);
}
