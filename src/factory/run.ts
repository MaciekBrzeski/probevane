import { spawn } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { readRuns, summarize, type RunRecord } from '../cost/ledger.js';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { isGitRepo, headSha, revertEdits } from '../util/git.js';
import { runPool } from '../util/concurrent.js';
import { aggregate, slug, type FactoryReport, type FactoryRepoResult } from './report.js';
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
  log: (l: string) => void;
}

function runChild(opts: FactoryOpts, repo: string, stateDir: string): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      opts.binPath,
      ['generate', repo, '--kind', opts.kind, ...opts.passThrough],
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

async function processRepo(repo: string, opts: FactoryOpts): Promise<FactoryRepoResult> {
  const dir = resolve(repo);
  const stateDir = join(opts.stateRoot, slug(repo));
  await mkdir(stateDir, { recursive: true });
  const before = opts.checkpoint ? await headSha(dir) : '';

  const code = await runChild(opts, dir, stateDir);

  // Cost/tokens from the repo's ISOLATED ledger (exit code is the truth on accept).
  const runs = await readRuns(join(stateDir, 'runs.jsonl')).catch(() => [] as RunRecord[]);
  const sum = summarize(runs);
  const accepted = code === 0;
  const stopReason = runs.at(-1)?.stopReason ?? (accepted ? 'accepted' : 'error');

  const base: FactoryRepoResult = {
    repo,
    accepted,
    stopReason,
    tests: 0,
    coverage: null,
    cost: sum.totalCost,
    tokensIn: sum.totalTokensIn,
    tokensOut: sum.totalTokensOut,
    reverted: false,
  };

  if (accepted) {
    // Measure the landed suite: test count (passed) + line coverage.
    try {
      const adapter = await selectAdapterOrThrow(dir);
      const specs = await adapter.specFiles(dir).catch(() => [] as string[]);
      if (specs.length) {
        const r = await adapter.run(dir, opts.kind as RunScope, specs).catch(() => null);
        if (r) base.tests = r.passed;
      }
      const cov = await adapter.coverage(dir).catch(() => null);
      base.coverage = cov ? cov.lines : null;
    } catch (e: any) {
      base.error = `measure: ${e?.message ?? e}`;
    }
  } else if (opts.checkpoint && (await isGitRepo(dir))) {
    // Errored run — undo whatever it half-wrote so the repo is left clean.
    const diary = await latestDiary(dir);
    if (diary?.editedFiles?.length) {
      await revertEdits(dir, diary.checkpointSha || before, diary.editedFiles).catch(() => {});
      base.reverted = true;
    }
  }
  return base;
}

export async function runFactory(opts: FactoryOpts): Promise<FactoryReport> {
  const results = await runPool(
    opts.repos,
    (r) =>
      processRepo(r, opts).catch(
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
      ),
    opts.concurrency,
  );
  return aggregate(results, new Date().toISOString());
}
