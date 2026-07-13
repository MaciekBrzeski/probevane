import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { auditFiles, formatViolations } from '../audit/core.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane audit` backend — static quality gate over the project's spec
// files, exit 1 on any error-severity violation (CI-usable). Logic moved
// verbatim from the old src/cli/audit.ts shell; the vane interpreter owns argv.

/** Run the audit against ctx.dir. */
export async function run(ctx: CommandCtx): Promise<void> {
  const adapter = await selectAdapterOrThrow(ctx.dir);
  const specs = await adapter.specFiles(ctx.dir);
  if (specs.length === 0) {
    console.log('[probevane] no spec files found');
    return;
  }
  const report = await auditFiles(specs.map((s) => join(ctx.dir, s)), adapter.auditRules());
  if (report.violations.length) console.log(formatViolations(report.violations));
  console.log(
    `[probevane] audit: ${report.filesChecked} file(s), ${report.errors} error(s), ${report.warns} warn(s), score ${report.score}/5`,
  );
  if (report.errors > 0) process.exit(1);
}
