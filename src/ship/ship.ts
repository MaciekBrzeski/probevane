import { resolve, join } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isGitRepo, createBranch, commitFiles, push, hasRemote } from '../util/git.js';
import { branchName, prTitle, prBody, openPr, type ShipInfo } from './pr.js';

// Autonomous delivery (Pillar A): take an accepted run's diary record and ship it
// — branch off the current HEAD, commit only the files the run edited, push, open
// a PR. Never touches the default branch; never merges. Degrades gracefully: no
// git repo / no files → skip; no remote/gh → leave the local branch + report.

export interface DiaryRecord {
  runId?: string;
  checkpointSha?: string;
  editedFiles?: string[];
}

export interface ShipResult {
  shipped: boolean;
  branch?: string;
  prUrl?: string;
  reason?: string;
}

/** Most recent diary record in a repo (runId + checkpointSha + editedFiles). */
export async function latestDiary(dir: string): Promise<DiaryRecord | null> {
  const dd = join(resolve(dir), '.probevane', 'diary');
  const files = (await readdir(dd).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  if (!files.length) return null;
  let newest = '';
  let mt = -1;
  for (const f of files) {
    const s = await stat(join(dd, f)).catch(() => null);
    if (s && s.mtimeMs > mt) {
      mt = s.mtimeMs;
      newest = f;
    }
  }
  return newest ? readFile(join(dd, newest), 'utf8').then(JSON.parse).catch(() => null) : null;
}

/** Files in the diary that still exist on disk (project-relative). */
async function presentFiles(dir: string, files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) if (await stat(join(dir, f)).then(() => true).catch(() => false)) out.push(f);
  return out;
}

export async function shipRun(
  dir: string,
  rec: DiaryRecord,
  meta: { op: string; repo: string; tests?: number; coverage?: number | null; cost?: number },
  log: (l: string) => void = () => {},
): Promise<ShipResult> {
  const root = resolve(dir);
  if (!(await isGitRepo(root))) return { shipped: false, reason: 'not a git repo' };
  const files = await presentFiles(root, rec.editedFiles ?? []);
  if (!files.length) return { shipped: false, reason: 'no edited files to ship' };

  const branch = branchName(rec.runId ?? 'run');
  if (!(await createBranch(root, branch))) return { shipped: false, reason: `could not create branch ${branch}` };

  const info: ShipInfo = { op: meta.op, repo: meta.repo, runId: rec.runId ?? 'run', files, tests: meta.tests, coverage: meta.coverage, cost: meta.cost };
  const title = prTitle(info);
  if (!(await commitFiles(root, files, title))) return { shipped: false, branch, reason: 'commit failed' };
  log(`[ship] committed ${files.length} file(s) on ${branch}`);

  if (!(await hasRemote(root))) {
    log(`[ship] no origin remote — left branch ${branch} locally (push + open PR manually)`);
    return { shipped: true, branch, reason: 'no remote (local branch only)' };
  }
  if (!(await push(root, branch))) return { shipped: true, branch, reason: 'push failed (branch committed locally)' };
  const pr = await openPr(root, { branch, title, body: prBody(info) });
  if (pr.ok) log(`[ship] PR opened: ${pr.url ?? '(url unavailable)'}`);
  else log(`[ship] pushed ${branch}; gh PR create unavailable — open the PR manually`);
  return { shipped: true, branch, prUrl: pr.url, reason: pr.ok ? undefined : 'gh unavailable (pushed)' };
}
