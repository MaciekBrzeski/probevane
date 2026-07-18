import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { runMutation, type MutationRun } from '../loop/mutation.js';
import { byDir, writeMutationBaseline, readMutationBaseline, checkRatchet, type DirScore } from '../loop/mutation-baseline.js';
import { appendLog } from '../library/improvement-log.js';
import type { CommandCtx } from '../vane/run-command.js';

/** The compact mutation summary the Checks tab reads (.probevane/mutation-report.json).
 *  Timestamped so the tab can show how stale the number is; heavy gates are never
 *  run live by the daemon, only surfaced from the last CLI run's artifact. */
export interface MutationArtifact {
  score: number;
  killed: number;
  survived: number;
  total: number;
  sampled: boolean;
  at: string; // ISO timestamp
  byDir: Record<string, DirScore>; // per-top-dir tallies — feeds the ratchet + Checks tab
}

/** Persist the compact summary for the Checks tab. Best-effort — a write failure
 *  must never fail the mutation run itself. */
async function writeArtifact(dir: string, r: MutationRun): Promise<void> {
  const artifact: MutationArtifact = {
    score: r.score, killed: r.killed, survived: r.survived, total: r.total,
    sampled: r.sampled, at: new Date().toISOString(), byDir: byDir(r),
  };
  try {
    await mkdir(join(dir, '.probevane'), { recursive: true });
    await writeFile(join(dir, '.probevane', 'mutation-report.json'), JSON.stringify(artifact, null, 2));
  } catch { /* best-effort */ }
}

// `probevane mutation` backend — full per-site mutation test: flips operators
// (===/!==/>=/<=/&&/true/+) one at a time, reruns the suite, reports killed vs
// SURVIVED (mutants the tests miss — the real signal that coverage isn't
// catching bugs). --min-score P exits 1 if below (CI gate). --budget caps
// mutants (sampled evenly). Logic moved verbatim from the old
// src/cli/mutation.ts shell; the vane interpreter owns argv. --only stays a
// raw string split in-handler (no filter) — verbatim old semantics.

/** Human report: score line, surviving-mutant sites, weakest files. */
function report(r: MutationRun): void {
  console.log(
    `\n[probevane] mutation score: ${Math.round(r.score * 100)}% ` +
      `(${r.killed}/${r.total} killed, ${r.survived} survived)${r.sampled ? ` [sampled ${r.total} of the full site set]` : ''}`,
  );
  if (r.survivors.length) {
    console.log(`\nSurviving mutants — tests do NOT catch these; strengthen the assertions:`);
    for (const m of r.survivors.slice(0, 40)) console.log(`  ${m.file}:${m.line}  ${m.op} → ${m.repl}    ${m.snippet}`);
    if (r.survivors.length > 40) console.log(`  … +${r.survivors.length - 40} more`);
  }
  const weak = Object.entries(r.byFile)
    .filter(([, v]) => v.killed < v.total)
    .sort((a, b) => a[1].killed / a[1].total - b[1].killed / b[1].total)
    .slice(0, 10);
  if (weak.length) {
    console.log(`\nWeakest files (mutation score):`);
    for (const [f, v] of weak) console.log(`  ${String(Math.round((v.killed / v.total) * 100)).padStart(3)}%  ${v.killed}/${v.total}  ${f}`);
  }
}

/** Run the budgeted/sampled mutation pass over ctx.dir, report (or --json),
 *  exit 1 when the score falls below --min-score. */
export async function run(ctx: CommandCtx): Promise<void> {
  const adapter = await selectAdapterOrThrow(ctx.dir);
  const only = ctx.flags.only as string | undefined;
  const r = await runMutation(ctx.dir, adapter, {
    budget: ctx.flags.budget as number | undefined,
    files: only ? only.split(',').map((s) => s.trim()) : undefined,
    all: ctx.flags.all === true,
    log: (l) => console.error(l),
  });

  await writeArtifact(ctx.dir, r);
  if (ctx.flags.json === true) console.log(JSON.stringify(r, null, 2));
  else report(r);

  // Append-only time-series of the score (fourier-nca discipline). Logged before
  // any gate exits so a failing run still records its number. The runner commits
  // the file — CI/loop drives the trend.
  const logPath = ctx.flags.log as string | undefined;
  if (logPath) {
    const dirs = Object.entries(byDir(r)).map(([d, s]) => `${d}:${s.score.toFixed(2)}`).join(' ');
    await appendLog(logPath, {
      timestamp: new Date().toISOString(), target: 'self', kind: 'mutation',
      mutation: r.score.toFixed(4), note: `per-dir ${dirs}`,
    });
    console.error(`[probevane] mutation: logged score to ${logPath}`);
  }

  if (ctx.flags['write-baseline'] === true) {
    const n = writeMutationBaseline(ctx.dir, r);
    console.error(`[probevane] mutation: wrote ${n} per-dir floor(s) to .probevane/mutation-baseline.json`);
    return; // recording the baseline is not also a gate
  }

  if (ctx.flags.ratchet === true) {
    const regressions = checkRatchet(r, readMutationBaseline(ctx.dir));
    if (regressions.length) {
      console.error(`[probevane] mutation: ${regressions.length} dir(s) regressed below baseline:`);
      for (const g of regressions)
        console.error(`  ${g.dir}/  ${(g.actual * 100).toFixed(0)}% < floor ${(g.floor * 100).toFixed(0)}%`);
      process.exit(1);
    }
    console.error('[probevane] mutation: ratchet ok — no dir below its floor');
  }

  const min = ctx.flags['min-score'] as number | undefined;
  if (min !== undefined && r.score < min) {
    console.error(`[probevane] mutation: score ${(r.score * 100).toFixed(0)}% < min ${(min * 100).toFixed(0)}%`);
    process.exit(1);
  }
}
