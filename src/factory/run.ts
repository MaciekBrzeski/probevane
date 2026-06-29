import { spawn } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { readRuns, summarize, type RunRecord } from '../cost/ledger.js';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { isGitRepo, headSha, revertEdits } from '../util/git.js';
import { shipRun } from '../ship/ship.js';
import { runPool } from '../util/concurrent.js';
import { aggregate, slug, type FactoryReport, type FactoryRepoResult } from './report.js';
import { readFederation } from '../mfe/scan.js';
import { versionAlign, type RepoShared } from '../mfe/standards.js';
import type { TestKind, RunScope } from '../adapters/adapter.js';

// The factory runner (Phase 3, substrate = local-concurrent): point probevane at
// many repos, run the gated generate loop on each with ISOLATED state (its own
// PROBEVANE_STATE so ledgers/traces/diaries never collide), revert any repo whose
// run errors, and roll the lot up into one cost/coverage/quality report. Each repo
// is a child process — true state isolation (LEDGER_PATH is import-time bound) and
// crash containment. Distribution across hosts is a later phase; this is the unit
// every substrate wraps. Pure report helpers live in report.ts (this file is the
// process/fs orchestration — excluded from coverage like the other I/O glue).

export interface FactoryOpts {
  repos: string[];
  kind: TestKind;
  concurrency: number;
  stateRoot: string; // base dir for per-repo isolated state subdirs
  passThrough: string[]; // extra flags forwarded verbatim to `generate`
  binPath: string; // path to bin/probevane
  checkpoint: boolean; // revert a repo's edits if its run errors
  ship: boolean; // on accept, branch + commit + open a PR (autonomous delivery)
  retry: boolean; // retry once on a transient (error) child failure
  skip: Set<string>; // repos to skip (carried from a prior report via --resume)
  prior: FactoryReport | null; // prior report whose accepted repos we carry on resume
  log: (l: string) => void;
}

function runChild(opts: FactoryOpts, repo: string, stateDir: string, reportPath: string): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      opts.binPath,
      ['generate', repo, '--kind', opts.kind, '--report', reportPath, ...opts.passThrough],
      { env: { ...process.env, PROBEVANE_STATE: stateDir }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const tag = `[${basename(repo)}]`;
    const pipe = (buf: Buffer) =>
      String(buf)
        .split('\n')
        .filter(Boolean)
        .forEach((l) => opts.log(`${tag} ${l}`));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('close', (code) => res(code ?? 1));
    child.on('error', () => res(1));
  });
}

/** The most recent diary record in a repo (checkpoint sha + edited files). */
async function latestDiary(
  dir: string,
): Promise<{ checkpointSha?: string; editedFiles?: string[] } | null> {
  const dd = join(dir, '.probevane', 'diary');
  const files = (await readdir(dd).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  if (!files.length) return null;
  let newest = '',
    mt = -1;
  for (const f of files) {
    const s = await stat(join(dd, f)).catch(() => null);
    if (s && s.mtimeMs > mt) {
      mt = s.mtimeMs;
      newest = f;
    }
  }
  return newest ? readFile(join(dd, newest), 'utf8').then(JSON.parse).catch(() => null) : null;
}

/** Newest stopReason in a ledger (the just-finished child's outcome). */
async function lastStop(stateDir: string): Promise<{ runs: RunRecord[]; stop: string }> {
  const runs = await readRuns(join(stateDir, 'runs.jsonl')).catch(() => [] as RunRecord[]);
  return { runs, stop: runs.at(-1)?.stopReason ?? 'error' };
}

/** Run the child, retrying once on a transient failure (a crashed/errored child —
 *  not a clean max_steps/difficulty/stuck, which won't change on a re-run). */
async function runWithRetry(
  opts: FactoryOpts,
  dir: string,
  repo: string,
  stateDir: string,
  reportPath: string,
): Promise<{ code: number; runs: RunRecord[]; stop: string }> {
  let code = await runChild(opts, dir, stateDir, reportPath);
  let { runs, stop } = await lastStop(stateDir);
  if (code !== 0 && opts.retry && stop === 'error') {
    opts.log(`[${basename(repo)}] transient failure (${stop}) — retrying once`);
    code = await runChild(opts, dir, stateDir, reportPath);
    ({ runs, stop } = await lastStop(stateDir));
  }
  return { code, runs, stop };
}

/** Fill tests/coverage on an accepted result. Prefer the child's --report (the
 *  gates already measured these — no second suite run in the parent). Fall back to
 *  measuring only if the report is absent. */
async function measureAccepted(
  dir: string,
  opts: FactoryOpts,
  reportPath: string,
  base: FactoryRepoResult,
): Promise<void> {
  const rep = await readFile(reportPath, 'utf8').then(JSON.parse).catch(() => null);
  if (rep && typeof rep.tests === 'number') {
    base.tests = rep.tests;
    base.coverage = typeof rep.coverage === 'number' ? rep.coverage : null;
    return;
  }
  try {
    const adapter = await selectAdapterOrThrow(dir);
    const specs = await adapter.specFiles(dir).catch(() => [] as string[]);
    if (specs.length) base.tests = (await adapter.run(dir, opts.kind as RunScope, specs).catch(() => null))?.passed ?? 0;
    base.coverage = (await adapter.coverage(dir).catch(() => null))?.lines ?? null;
  } catch (e: any) {
    base.error = `measure: ${e?.message ?? e}`;
  }
}

/** Autonomous delivery: branch + commit + PR the accepted run. */
async function shipAccepted(
  dir: string,
  opts: FactoryOpts,
  repo: string,
  base: FactoryRepoResult,
): Promise<void> {
  if (!opts.ship) return;
  const diary = await latestDiary(dir);
  if (!diary) return;
  const r = await shipRun(dir, diary, { op: 'generate', repo, tests: base.tests, coverage: base.coverage, cost: base.cost }, opts.log).catch(() => null);
  base.shipped = !!r?.shipped;
  base.prUrl = r?.prUrl;
}

/** Errored run — undo whatever it half-wrote so the repo is left clean. */
async function revertErrored(
  dir: string,
  opts: FactoryOpts,
  before: string,
  base: FactoryRepoResult,
): Promise<void> {
  if (!(opts.checkpoint && (await isGitRepo(dir)))) return;
  const diary = await latestDiary(dir);
  if (diary?.editedFiles?.length) {
    await revertEdits(dir, diary.checkpointSha || before, diary.editedFiles).catch(() => {});
    base.reverted = true;
  }
}

async function processRepo(repo: string, opts: FactoryOpts): Promise<FactoryRepoResult> {
  const dir = resolve(repo);
  const stateDir = join(opts.stateRoot, slug(repo));
  await mkdir(stateDir, { recursive: true });
  const before = opts.checkpoint ? await headSha(dir) : '';
  const reportPath = join(stateDir, 'result.json');

  const { code, runs, stop } = await runWithRetry(opts, dir, repo, stateDir, reportPath);

  const sum = summarize(runs);
  const accepted = code === 0;
  const base: FactoryRepoResult = {
    repo,
    accepted,
    stopReason: accepted ? 'accepted' : stop,
    tests: 0,
    coverage: null,
    cost: sum.totalCost,
    tokensIn: sum.totalTokensIn,
    tokensOut: sum.totalTokensOut,
    reverted: false,
  };

  if (accepted) {
    await measureAccepted(dir, opts, reportPath, base);
    await shipAccepted(dir, opts, repo, base);
  } else {
    await revertErrored(dir, opts, before, base);
  }
  return base;
}

export async function runFactory(opts: FactoryOpts): Promise<FactoryReport> {
  const priorByRepo = new Map((opts.prior?.results ?? []).map((r) => [r.repo, r] as const));
  const results = await runPool(
    opts.repos,
    (r) => {
      // --resume: carry an accepted repo's prior result instead of re-running it.
      if (opts.skip.has(r)) {
        opts.log(`[${basename(r)}] cached (resume) — skipping`);
        const prev = priorByRepo.get(r);
        return Promise.resolve<FactoryRepoResult>(
          prev
            ? { ...prev, cached: true }
            : { repo: r, accepted: true, stopReason: 'accepted', tests: 0, coverage: null, cost: 0, tokensIn: 0, tokensOut: 0, reverted: false, cached: true },
        );
      }
      return processRepo(r, opts).catch(
        (e): FactoryRepoResult => ({
          repo: r,
          accepted: false,
          stopReason: 'error',
          tests: 0,
          coverage: null,
          cost: 0,
          tokensIn: 0,
          tokensOut: 0,
          reverted: false,
          error: String(e?.message ?? e),
        }),
      );
    },
    opts.concurrency,
  );
  const report = aggregate(results, new Date().toISOString());

  // Cross-repo: if ≥2 repos are Module-Federation MFEs, check shared-version
  // alignment across the fleet (a singleton at different versions breaks at runtime).
  const feds: RepoShared[] = [];
  for (const repo of opts.repos) {
    const cfg = await readFederation(resolve(repo)).catch(() => null);
    if (cfg) {
      const pkg = await readFile(join(resolve(repo), 'package.json'), 'utf8').then(JSON.parse).catch(() => ({}));
      feds.push({ name: cfg.name || repo, shared: cfg.shared, pkg });
    }
  }
  if (feds.length >= 2) {
    const align = versionAlign(feds);
    if (align.length) report.mfeVersionAlign = align;
  }
  return report;
}
