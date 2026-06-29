import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Coverage-gap targeting — parse the v8/istanbul `coverage/coverage-final.json`
// into the exact uncovered lines + functions per file, so generation can aim at
// the gaps instead of guessing. Highest coverage-per-token.

export interface FileGap {
  file: string; // project-relative
  uncoveredLines: number[];
  uncoveredFns: string[];
}

export async function parseGaps(dir: string): Promise<FileGap[]> {
  const path = join(dir, 'coverage', 'coverage-final.json');
  let data: Record<string, any>;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return [];
  }

  const out: FileGap[] = [];
  for (const entry of Object.values(data)) {
    const abs = entry.path as string;
    if (!abs || /node_modules|\.(test|spec)\./.test(abs)) continue;

    const lines = new Set<number>();
    const sMap = entry.statementMap ?? {};
    const s = entry.s ?? {};
    for (const [id, count] of Object.entries(s)) {
      if (count === 0 && sMap[id]?.start?.line) lines.add(sMap[id].start.line);
    }

    const fns: string[] = [];
    const fnMap = entry.fnMap ?? {};
    const f = entry.f ?? {};
    for (const [id, count] of Object.entries(f)) {
      if (count === 0 && fnMap[id]?.name) fns.push(fnMap[id].name);
    }

    if (lines.size || fns.length) {
      out.push({
        file: relative(dir, abs),
        uncoveredLines: [...lines].sort((a, b) => a - b),
        uncoveredFns: [...new Set(fns)],
      });
    }
  }
  return out;
}

/** A compact prompt fragment naming the gaps for the model to target. */
export function gapsDigest(gaps: FileGap[]): string {
  if (!gaps.length) return '';
  const lines = ['COVERAGE GAPS — write tests that exercise these specifically:'];
  for (const g of gaps.slice(0, 12)) {
    const fns = g.uncoveredFns.length ? ` fns: ${g.uncoveredFns.join(', ')};` : '';
    const ls = g.uncoveredLines.length ? ` lines: ${g.uncoveredLines.slice(0, 25).join(',')}` : '';
    lines.push(`- ${g.file}:${fns}${ls}`);
  }
  return lines.join('\n');
}
