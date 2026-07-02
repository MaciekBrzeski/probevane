import { selectAdapterOrThrow } from '../adapters/registry.js';
import { parseGaps } from '../coverage/gaps.js';
import { scanProject } from '../quality/scan.js';
import { scanMfe } from '../mfe/scan.js';
import { buildPlan, untestedTargets, formatPlan } from '../plan/build.js';
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

  const adapter = await selectAdapterOrThrow(dir);
  const targets = await adapter.discover(dir, kind).catch(() => []);
  const specs = await adapter.specFiles(dir).catch(() => []);
  const untested = untestedTargets(targets, specs);
  const gaps = await parseGaps(dir).catch(() => []);
  const quality = await scanProject(dir).catch(() => null);
  const mfe = await scanMfe(dir).catch(() => null);

  const plan = buildPlan({
    untested,
    coverageGaps: gaps.map((g) => g.file).filter((f) => !untested.includes(f)),
    qualityErrors: quality
      ? quality.violations.filter((v) => v.severity === 'error').map((v) => ({ file: v.file, message: `[${v.rule}] ${v.message}` }))
      : [],
    mfeErrors: mfe
      ? mfe.audit.violations.filter((v) => v.severity === 'error').map((v) => ({ file: v.file, message: `[${v.rule}] ${v.message}` }))
      : [],
  });

  if (args.includes('--json')) {
    console.log(JSON.stringify({ dir, adapter: adapter.id, ...plan }, null, 2));
    return;
  }
  console.log(`[probevane] plan for ${dir} (adapter ${adapter.id}${mfe ? ', Module Federation' : ''})\n`);
  console.log(formatPlan(plan));
  console.log(`\n[probevane] ${plan.summary}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
