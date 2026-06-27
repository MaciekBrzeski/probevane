import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { statePath } from '../util/state.js';
import { appendJsonl } from '../util/jsonl.js';
import { newItem } from '../observe/queue.js';
import { parseRepoList } from '../factory/report.js';

// probevane scan <repos.txt | dir...> [--op generate] [--root <stateDir>] [...op flags]
//
// Intake: enqueue one work item per repo for the supervisor to dispatch. Feed it a
// repo-list (or dirs); a daemon with PROBEVANE_QUEUE=1 drains them. The autonomous
// front door to the dark factory.
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function isFile(p: string): Promise<boolean> {
  return await stat(p).then((s) => s.isFile()).catch(() => false);
}

async function main() {
  const args = process.argv.slice(2);
  const op = flag(args, '--op') ?? 'generate';
  const root = flag(args, '--root');
  const VALUE_FLAGS = new Set(['--op', '--root']);
  const positionals = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));

  let repos: string[] = [];
  if (positionals.length === 1 && (await isFile(resolve(positionals[0])))) repos = parseRepoList(await readFile(resolve(positionals[0]), 'utf8'));
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

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
