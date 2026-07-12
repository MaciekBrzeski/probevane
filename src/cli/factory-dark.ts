import { resolve, join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { statePath } from '../util/state.js';
import { appendJsonl } from '../util/jsonl.js';
import { itemFromPlan } from '../observe/jobs.js';
import { validateLaunch } from '../observe/launch.js';
import { readRuns } from '../cost/ledger.js';
import { buildSpec } from '../spec-run/build-spec.js';
import { saveSpec, loadSpec, specToLaunchPlan, specsDir, type RunSpec } from '../spec-run/runspec.js';
import { expandSpec, expandSummary } from '../spec-run/expand.js';
import { buildDarkReport, formatDarkReport } from '../spec-run/report.js';
import { gatherPlan } from '../spec-run/gather.js';
import { flag, positionals } from '../util/args.js';

// probevane factory-dark "<prompt>" <dir> [--answers f.json | --interactive]
//     [--model m] [--takeover t] [--strict] [--root <state>] [--dry-run] [--json]
// probevane factory-dark --report <batchId> [--root <state>] [--json]
//
// The dark factory: prompt → RunSpec (intake) → per-file decomposition → enqueue
// each unit onto the supervisor queue. A daemon started with PROBEVANE_QUEUE=1
// runs them unattended, ships accepted units, and parks deterministic give-ups
// (the stopReason-aware dispatch). `--report` rolls the ledger up per unit.
const VALUE_FLAGS = ['--answers', '--model', '--takeover', '--root', '--report'];

interface Batch {
  parentId: string;
  dir: string;
  prompt: string;
  childIds: string[];
}

const queuePath = (root?: string) => (root ? join(resolve(root), 'queue.jsonl') : statePath('queue.jsonl'));
const batchPath = (id: string, root?: string) => join(specsDir(root), `${id}.batch.json`);

/** Enqueue every dark-runnable child; return the ids actually queued. */
async function enqueueChildren(children: RunSpec[], root?: string): Promise<string[]> {
  const path = queuePath(root);
  const queued: string[] = [];
  for (const child of children) {
    const plan = specToLaunchPlan(child);
    const v = validateLaunch(plan);
    if (!v.ok) {
      console.error(`[probevane] skip ${child.id} (${child.only ?? child.path}): ${v.error}`);
      continue;
    }
    await appendJsonl(path, itemFromPlan(v.plan));
    queued.push(child.id);
  }
  return queued;
}

// Run mode: prompt → parent spec → per-file children → enqueue for the supervisor
// (--dry-run just lists the units); prints the daemon/report follow-up commands.
async function runMode(args: string[]) {
  const root = flag(args, '--root');
  const pos = positionals(args, VALUE_FLAGS);
  const prompt = pos[0];
  const dir = resolve(pos[1] ?? '.');
  if (!prompt) {
    console.error('usage: probevane factory-dark "<prompt>" <dir> [--answers f.json | --interactive] [--dry-run]');
    process.exit(2);
  }

  const parent = await buildSpec(prompt, dir, args);
  await saveSpec(parent, root);
  const { adapterId, plan } = await gatherPlan(dir, parent.kind);
  const children = expandSpec(parent, plan.items);
  if (!children.length) {
    console.log(`[probevane] nothing to do — no targets for "${prompt}" (adapter ${adapterId})`);
    return;
  }
  for (const c of children) await saveSpec(c, root);
  const batch: Batch = { parentId: parent.id, dir, prompt, childIds: children.map((c) => c.id) };
  await writeFile(batchPath(parent.id, root), JSON.stringify(batch, null, 2));

  console.log(`[probevane] factory-dark ${parent.id} → ${parent.path} · ${expandSummary(children)} (adapter ${adapterId})`);
  if (args.includes('--dry-run')) {
    for (const c of children) console.log(`  · ${c.only ?? '(repo)'}${c.targetGaps ? ' [gaps]' : ''}`);
    console.log('[probevane] dry-run — nothing enqueued');
    return;
  }
  const queued = await enqueueChildren(children, root);
  console.log(`[probevane] enqueued ${queued.length}/${children.length} unit(s) → ${queuePath(root)}`);
  console.log(`  run:    PROBEVANE_QUEUE=1${root ? ` PROBEVANE_STATE=${resolve(root)}` : ''} probevane daemon`);
  console.log(`  watch:  probevane factory-dark --report ${parent.id}${root ? ` --root ${root}` : ''}`);
  if (args.includes('--json')) console.log(JSON.stringify({ batch, queued }, null, 2));
}

// --report <batchId>: roll the ledger up per child spec of a batch (human or --json).
async function reportMode(args: string[]) {
  const root = flag(args, '--root');
  const id = flag(args, '--report')!;
  const batch = JSON.parse(await readFile(batchPath(id, root), 'utf8')) as Batch;
  const specs = await Promise.all(batch.childIds.map((c) => loadSpec(c, root)));
  const records = await readRuns(root ? join(resolve(root), 'runs.jsonl') : undefined);
  const report = buildDarkReport(specs, records);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`[probevane] batch ${id} — "${batch.prompt}"`);
  console.log(formatDarkReport(report));
}

// Entry: --report switches to the rollup; anything else launches a batch.
async function main() {
  const args = process.argv.slice(2);
  if (flag(args, '--report')) return reportMode(args);
  return runMode(args);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
