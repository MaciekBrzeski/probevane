import { formatPlan } from '../commands/plan/build.js';
import { gatherPlan } from '../spec-run/gather.js';
import type { TestKind } from '../adapters/adapter.js';
import { flag, dirArg } from './args.js';

// probevane plan <dir> [--kind unit|e2e] [--json]
//
// Read-only action plan ($0, no LLM): combine untested targets, coverage gaps,
// source-quality errors, and MFE standards errors into a prioritized to-do list of
// generate/refactor/fix/mfe-fix steps. The map before you point the loop at a repo.

async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const kind = (flag(args, '--kind') ?? 'unit') as TestKind;

  const { adapterId, plan, mfe } = await gatherPlan(dir, kind);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ dir, adapter: adapterId, ...plan }, null, 2));
    return;
  }
  console.log(`[probevane] plan for ${dir} (adapter ${adapterId}${mfe ? ', Module Federation' : ''})\n`);
  console.log(formatPlan(plan));
  console.log(`\n[probevane] ${plan.summary}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
