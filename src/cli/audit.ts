import { resolve, join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { auditFiles, formatViolations } from '../audit/core.js';

// probevane audit <dir> — static quality gate over the project's spec files.
// Exit 1 on any error-severity violation (so it can also serve in CI).
async function main() {
  const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
  const adapter = await selectAdapterOrThrow(dir);
  const specs = await adapter.specFiles(dir);
  if (specs.length === 0) {
    console.log('[probevane] no spec files found');
    return;
  }
  const report = await auditFiles(specs.map((s) => join(dir, s)), adapter.auditRules());
  if (report.violations.length) console.log(formatViolations(report.violations));
  console.log(
    `[probevane] audit: ${report.filesChecked} file(s), ${report.errors} error(s), ${report.warns} warn(s), score ${report.score}/5`,
  );
  if (report.errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
