import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import type { StackAdapter } from '../adapters/adapter.js';

// doctor --full — one scorecard over the READ-ONLY graders. Aggregation, not
// duplication: each line reuses the same pure core its dedicated command runs
// (audit/core, assertion-score, quality/scan, adapter.coverage, arch/metrics).
// Heavy graders that execute the suite repeatedly (mutation, flake) are listed
// as skipped with the command to run — a health report should stay cheap.

export interface FullLine {
  area: string;
  summary: string;
  ok: boolean;
}

const exists = (p: string) => access(p).then(() => true).catch(() => false);

export async function fullReport(dir: string, adapter?: StackAdapter): Promise<FullLine[]> {
  return [
    ...(adapter ? await suiteLines(dir, adapter) : []),
    await qualityLine(dir),
    await archLine(dir),
    { area: 'mutation', summary: 'skipped (runs the suite per mutant) — probevane mutation <dir> --budget 60', ok: true },
    { area: 'flake', summary: 'skipped (repeats the suite) — probevane review <dir> --flake 3', ok: true },
  ];
}

/** Suite-facing graders: audit + assertion strength over the specs, coverage via the adapter. */
async function suiteLines(dir: string, adapter: StackAdapter): Promise<FullLine[]> {
  const lines: FullLine[] = [];
  try {
    const specs = await adapter.specFiles(dir);
    lines.push(await auditLine(dir, adapter, specs));
    if (specs.length) lines.push(await assertionLine(dir, specs));
  } catch (e) {
    lines.push({ area: 'audit', summary: `failed: ${String(e).slice(0, 100)}`, ok: false });
  }
  const cov = await adapter.coverage(dir).catch(() => null);
  lines.push(
    cov?.ok
      ? { area: 'coverage', summary: `${cov.lines}% lines · ${cov.functions}% funcs · ${cov.branches}% branches`, ok: cov.lines >= 80 }
      : { area: 'coverage', summary: 'unavailable — run the coverage command first', ok: false },
  );
  return lines;
}

async function auditLine(dir: string, adapter: StackAdapter, specs: string[]): Promise<FullLine> {
  if (!specs.length) return { area: 'audit', summary: 'no spec files — probevane generate', ok: false };
  const { auditFiles } = await import('../audit/core.js');
  const report = await auditFiles(specs.map((s) => join(dir, s)), adapter.auditRules());
  const errors = report.violations.filter((v) => v.severity === 'error').length;
  const warns = report.violations.length - errors;
  return { area: 'audit', summary: `${specs.length} spec file(s): ${errors} error(s), ${warns} warn(s)`, ok: errors === 0 };
}

async function assertionLine(dir: string, specs: string[]): Promise<FullLine> {
  const { scoreAssertions, aggregateScore } = await import('../audit/assertion-score.js');
  const perFile = await Promise.all(specs.map(async (s) => ({
    file: s,
    s: scoreAssertions(await readFile(join(dir, s), 'utf8').catch(() => '')),
  })));
  const agg = aggregateScore(perFile);
  return { area: 'assertions', summary: `${agg.score}/100 strong (${agg.weak} weak of ${agg.total})`, ok: agg.score >= 70 };
}

/** Source quality — pure heuristic analyzer, same core as `probevane quality`. */
async function qualityLine(dir: string): Promise<FullLine> {
  try {
    const { scanProject } = await import('../quality/scan.js');
    const q = await scanProject(dir);
    return { area: 'quality', summary: `${q.score}/100 (${q.errors} error(s), ${q.warns} warn(s) over ${q.files.length} files)`, ok: q.errors === 0 };
  } catch (e) {
    return { area: 'quality', summary: `failed: ${String(e).slice(0, 100)}`, ok: false };
  }
}

/** Architecture — coupling metrics + drift vs the committed snapshot. */
async function archLine(dir: string): Promise<FullLine> {
  try {
    const { buildGraph } = await import('../mock/graph.js');
    const { archMetrics, archDrift } = await import('../commands/arch/metrics.js');
    const metrics = archMetrics(await buildGraph(dir));
    let driftNote = 'no snapshot (arch --snapshot to start tracking)';
    const snapPath = join(dir, 'docs', 'arch-snapshot.json');
    if (await exists(snapPath)) {
      const prev = JSON.parse(await readFile(snapPath, 'utf8')).metrics;
      const drift = archDrift(prev, metrics);
      driftNote = drift.length ? `${drift.length} drift line(s) vs snapshot` : 'no drift vs snapshot';
    }
    return {
      area: 'arch',
      summary: `${metrics.dirs.length} dirs · ${metrics.cycles.length} cycle(s) · ${driftNote}`,
      ok: metrics.cycles.length === 0,
    };
  } catch (e) {
    return { area: 'arch', summary: `failed: ${String(e).slice(0, 100)}`, ok: false };
  }
}
