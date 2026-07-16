import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { statePath } from '../util/state.js';
import { appendJsonl } from '../util/jsonl.js';
import { newItem } from '../observe/queue.js';
import { parseRepoList } from '../factory/report.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane scan` backend — enqueue one work item per repo for the supervisor
// to dispatch (a PROBEVANE_QUEUE=1 daemon drains them). The autonomous front
// door to the dark factory. Moved verbatim from the old shell; the variadic
// `repos str...` positional (ctx.rest) replaces the hand-rolled argv filter.

/** True when path is a regular file. */
async function isFile(p: string): Promise<boolean> {
  return await stat(p).then((s) => s.isFile()).catch(() => false);
}

/** Resolve ctx.rest (a single repo-list file OR a list of dirs) and enqueue one
 *  item per repo under the resolved queue path. */
export async function run(ctx: CommandCtx): Promise<void> {
  const op = (ctx.flags.op as string | undefined) ?? 'generate';
  const root = ctx.flags.root as string | undefined;
  const positionals = ctx.rest;

  let repos: string[] = [];
  if (positionals.length === 1 && (await isFile(resolve(positionals[0]))))
    repos = parseRepoList(await readFile(resolve(positionals[0]), 'utf8'));
  else repos = positionals;
  if (!repos.length) {
    console.error('usage: probevane scan <repos.txt | dir...> [--op generate] [--root <stateDir>]');
    process.exit(2);
  }

  const path = root ? join(resolve(root), 'queue.jsonl') : statePath('queue.jsonl');
  for (const repo of repos) {
    const item = newItem(randomUUID().slice(0, 8), op, resolve(repo), [], new Date().toISOString());
    await appendJsonl(path, item);
  }
  console.log(`[probevane] enqueued ${repos.length} ${op} item(s) → ${path}`);
}
