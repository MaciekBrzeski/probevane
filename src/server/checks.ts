import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { scanProject } from '../quality/scan.js';
import { applyBaseline } from '../quality/baseline.js';
import { buildGraph } from '../mock/graph.js';
import { pyramidReport } from '../arch/pyramid.js';
import { crowdingReport } from '../arch/crowding.js';
import { archMetrics } from '../arch/metrics.js';
import { loadConfig } from '../util/config.js';

// The /checks aggregate behind the control center's Checks tab: run the CHEAP
// gates live (quality, pyramid, crowding, dir cycles) and read the heavy ones
// from their persisted artifacts (coverage summary, eval improvement-log).
// Heavy gates with no artifact (mutation, e2e) stay CI-only — the tab shows
// them as absent rather than guessing.

import type { ChecksReport } from '../util/checks-shape.js';
export type { ChecksReport } from '../util/checks-shape.js';

/** Coverage totals from vitest's coverage-summary.json, or null when the
 *  artifact isn't on disk (coverage is a CI/manual gate, not run live here). */
async function readCoverage(dir: string): Promise<ChecksReport['coverage']> {
  try {
    const j = JSON.parse(await readFile(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'));
    const t = j.total;
    return { statements: t.statements.pct, branches: t.branches.pct, functions: t.functions.pct, lines: t.lines.pct };
  } catch {
    return null;
  }
}

/** Tail of eval/improvement-log.csv as per-BATCH pass ratios (the fixture-eval
 *  history sparkline). Rows are per-case (timestamp,target,kind,pass,…) and a
 *  batch shares one timestamp, so grouping by it recovers each eval run. The
 *  log is append-only, so the tail IS the recent trend. */
async function readEvalHistory(dir: string, tailN = 30): Promise<ChecksReport['evalHistory']> {
  const csv = await readFile(join(dir, 'eval', 'improvement-log.csv'), 'utf8').catch(() => '');
  const batches = new Map<string, { passed: number; total: number }>();
  for (const row of csv.trim().split('\n').slice(1)) {
    const cols = row.split(',');
    const pass = Number(cols[3]);
    if (!cols[0] || !Number.isFinite(pass)) continue;
    const b = batches.get(cols[0]) ?? { passed: 0, total: 0 };
    b.passed += pass ? 1 : 0;
    b.total += 1;
    batches.set(cols[0], b);
  }
  return [...batches.entries()]
    .slice(-tailN)
    .map(([label, b]) => ({ label: label.slice(0, 10), ratio: b.total ? b.passed / b.total : 0 }));
}

/** Last mutation CLI run's compact summary, or null when no artifact exists
 *  (mutation is a heavy gate — never run live here, only surfaced if a run left
 *  .probevane/mutation-report.json behind). */
async function readMutation(dir: string): Promise<ChecksReport['mutation']> {
  try {
    const j = JSON.parse(await readFile(join(dir, '.probevane', 'mutation-report.json'), 'utf8'));
    return { score: j.score, survived: j.survived, total: j.total, sampled: j.sampled, at: j.at };
  } catch {
    return null;
  }
}

/** Run the cheap checks + read the artifacts for one project dir. */
export async function collectChecks(dirIn: string): Promise<ChecksReport> {
  const dir = resolve(dirIn);
  const [raw, graph, cfg, coverage, mutation, evalHistory] = await Promise.all([
    scanProject(dir),
    buildGraph(dir),
    loadConfig(dir),
    readCoverage(dir),
    readMutation(dir),
    readEvalHistory(dir),
  ]);
  // Grade the RATCHETED view (what the gate enforces) but count the raw doc
  // backlog too — the tab shows both the gate verdict and the honest debt.
  const gated = applyBaseline(dir, raw);
  const docBacklog = raw.violations.filter((v) => v.rule === 'doc-comment' || v.rule === 'type-doc').length;

  const pyr = pyramidReport(graph, cfg.arch ?? {});
  const roles = (r: string) => pyr.dirs.filter((d) => d.role === r).length;
  const crowded = crowdingReport(graph, cfg.arch?.maxFiles ?? 15);

  return {
    quality: {
      grade: gated.score, errors: gated.errors, warns: gated.warns,
      files: raw.files.length, functions: raw.functions, docBacklog,
    },
    pyramid: {
      score: pyr.score, violations: pyr.violations.length,
      features: roles('feature'), glue: roles('glue'), shared: roles('shared'),
    },
    crowding: crowded.map((c) => ({ dir: c.dir, files: c.files })),
    cycles: archMetrics(graph).cycles.length,
    coverage,
    mutation,
    evalHistory,
  };
}
