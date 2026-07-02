import { resolve } from 'node:path';
import { runDoctor } from '../doctor/checks.js';
import { selectAdapter } from '../adapters/registry.js';

// probevane doctor <dir> [--fix] [--json]
//
// Detect (and with --fix, repair) the failure classes that silently degrade a
// harness setup: broken toolchains, coverage blind spots, git-tracked test
// artifacts, package-manifest lies, CI steps that swallow failures, stale
// replay cassettes. Each check exists because it bit for real — see
// src/doctor/checks.ts for provenance. Exit 1 when unfixed errors remain.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const fix = args.includes('--fix');

  const adapter = await selectAdapter(dir);
  const report = await runDoctor(dir, adapter ?? undefined);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ findings: report.findings, fixable: report.fixes.length }, null, 2));
    process.exit(report.findings.some((f) => f.severity === 'error') ? 1 : 0);
  }

  if (!report.findings.length) {
    console.log(`[probevane] doctor: healthy (${adapter ? adapter.id : 'no adapter detected'})`);
    return;
  }

  console.log(`### 🩺 probevane doctor — ${report.findings.length} finding(s)\n`);
  for (const f of report.findings) {
    const tag = f.severity === 'error' ? '🛑' : '⚠️';
    console.log(`${tag} [${f.check}] ${f.message}`);
    if (f.hint) console.log(`   ↳ ${f.fixable ? (fix ? 'fixing: ' : 'fixable with --fix: ') : ''}${f.hint}`);
  }

  if (fix && report.fixes.length) {
    console.log('');
    for (const x of report.fixes) {
      const result = await x.apply().catch((e) => `fix failed: ${e}`);
      console.log(`🔧 [${x.finding.check}] ${result}`);
    }
  }

  const unfixedErrors = report.findings.filter(
    (f) => f.severity === 'error' && !(fix && f.fixable),
  ).length;
  if (unfixedErrors) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
