import { execFile } from 'node:child_process';

// PR construction for autonomous delivery (Pillar A). The title/body BUILDERS are
// pure (testable); openPr shells out to `gh`. A run that accepted gets branched,
// committed, and opened as a PR — the factory's actual output.

export interface ShipInfo {
  op: string; // generate / refactor / …
  repo: string;
  runId: string;
  files: string[];
  tests?: number;
  coverage?: number | null;
  cost?: number;
}

/** Branch name for a run — never the default branch. */
export function branchName(runId: string): string {
  return `probevane/${(runId || 'run').replace(/[^a-zA-Z0-9._/-]+/g, '-')}`;
}

/** One-line PR title: op + file count + repo basename — scannable in a PR list. */
export function prTitle(info: ShipInfo): string {
  return `probevane(${info.op}): ${info.files.length} file(s) in ${info.repo.split('/').pop() || info.repo}`;
}

/** PR body: what ran, whichever result stats exist, the shipped files, and
 *  the review-before-merge note (probevane never merges). */
export function prBody(info: ShipInfo): string {
  const stat: string[] = [];
  if (info.tests !== undefined) stat.push(`${info.tests} tests`);
  if (info.coverage != null) stat.push(`cov ${info.coverage}%`);
  if (info.cost !== undefined) stat.push(`$${info.cost.toFixed(4)}`);
  return [
    `Automated **${info.op}** by probevane — all gates green (suite + audit + acceptance).`,
    stat.length ? `\nResult: ${stat.join(' · ')}` : '',
    `\nFiles:`,
    ...info.files.map((f) => `- \`${f}\``),
    `\n_Run \`${info.runId}\`. Review before merge — probevane opens the PR, it does not merge._`,
  ].join('\n');
}

/** Open a PR via the gh CLI. Returns the PR url on success. */
export function openPr(
  dir: string,
  args: { branch: string; title: string; body: string },
): Promise<{ ok: boolean; url?: string }> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'create', '--head', args.branch, '--title', args.title, '--body', args.body],
      { cwd: dir, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        const url = (stdout ?? '').trim().split('\n').find((l) => l.startsWith('http'));
        resolve({ ok: !err, url });
      },
    );
  });
}
