import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { statePath } from '../util/state.js';
import { appendJsonl } from '../util/jsonl.js';
import { newItem } from '../observe/queue.js';
import { validateLaunch } from '../observe/launch.js';

// probevane enqueue <op> <dir> [--root <stateDir>] [...op flags]
//
// Add one work item to the supervisor queue (<root>/queue.jsonl). A daemon started
// with PROBEVANE_QUEUE=1 picks it up on its next tick and dispatches it.
async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const op = positional[0];
  const dir = positional[1];
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? args[rootIdx + 1] : undefined;
  // Forward everything except op/dir/--root as op flags.
  const flags = args.filter((a, i) => a !== op && a !== dir && a !== '--root' && args[i - 1] !== '--root');

  const v = validateLaunch({ op, dir, flags });
  if (!v.ok) {
    console.error(`usage: probevane enqueue <op> <dir> [--root <stateDir>] [...flags]\n  ${v.error}`);
    process.exit(2);
  }
  const path = root ? join(resolve(root), 'queue.jsonl') : statePath('queue.jsonl');
  const item = newItem(
    randomUUID().slice(0, 8),
    v.plan.op,
    resolve(v.plan.dir),
    v.plan.flags,
    new Date().toISOString(),
  );
  await appendJsonl(path, item);
  console.log(`[probevane] enqueued ${item.op} ${item.dir} (${item.id}) → ${path}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
