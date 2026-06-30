import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoverageResult } from './adapter.js';

// Shared coverage-summary parser. Both the angular (jest) and vitest-based
// adapters read coverage/coverage-summary.json the same way; this is the one
// home for that parse + the zero/ok:false fallback when it's absent/unparsable.
// Callers that also surface a `raw` blob spread their own onto the result.

/** Parse coverage/coverage-summary.json into percentages; zero + ok:false on failure. */
export async function readCoverageSummary(dir: string): Promise<CoverageResult> {
  try {
    const j = JSON.parse(await readFile(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'));
    const t = j.total;
    return {
      statements: t.statements.pct,
      branches: t.branches.pct,
      functions: t.functions.pct,
      lines: t.lines.pct,
      ok: true,
    };
  } catch {
    return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false };
  }
}
