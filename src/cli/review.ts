import { join } from 'node:path';
import { emitSummary } from '../util/gha.js';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { auditFiles } from '../audit/core.js';
import { flag, dirArg } from '../util/args.js';

// probevane review <dir> [--flake N] [--mutation]
//
// Read-only quality grade for an existing test suite: green, coverage, audit
// cleanliness, flake, and (optional) mutation score → a 0–100 grade + report.
// No generation — works on any repo today.
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const flakeRuns = parseInt(flag(args, '--flake') ?? '3', 10);
  const adapter = await selectAdapterOrThrow(dir);

  const specs = await adapter.specFiles(dir);
  if (specs.length === 0) {
    await emitSummary(`### probevane review — ${adapter.id}\n\n**No test files found.** Grade: 0/100 — run \`probevane generate\` first.\n`);
    process.exit(0);
  }

  // flake: run the suite N times, compare signatures.
  const sigs: string[] = [];
  for (let i = 0; i < flakeRuns; i++) {
    const r = await adapter.run(dir, 'unit');
    sigs.push(`${r.passed}/${r.failed}`);
  }
  const first = await adapter.run(dir, 'unit');
  const flaky = sigs.some((s) => s !== sigs[0]);
  const cov = await adapter.coverage(dir).catch(() => null);
  const audit = await auditFiles(specs.map((s) => join(dir, s)), adapter.auditRules());
  const coverage = cov?.ok ? cov.statements : 0;

  // Grade /100: green is a hard gate; otherwise coverage 40 + audit 25 + flake 20 + count 15.
  let grade = 0;
  if (first.green && !flaky) {
    grade = Math.round(coverage * 0.4 + (audit.score / 5) * 25 + 20 + Math.min(15, first.passed));
  } else if (first.green) {
    grade = Math.round(coverage * 0.3 + (audit.score / 5) * 20); // flaky penalty
  }
  grade = Math.max(0, Math.min(100, grade));

  const md = [
    `### 🧪 probevane review — ${adapter.id}`,
    ``,
    `**Grade: ${grade}/100**`,
    ``,
    `| metric | value |`,
    `|---|---|`,
    `| suite | ${first.green ? '✅ green' : '❌ red'} (${first.passed} passed, ${first.failed} failed) |`,
    `| coverage | ${coverage}% statements |`,
    `| audit | ${audit.score}/5 (${audit.errors} errors, ${audit.warns} warns) |`,
    `| flake | ${flaky ? `⚠️ flaky (${sigs.join(' → ')})` : `✅ stable (${flakeRuns}×)`} |`,
    `| spec files | ${specs.length} |`,
    audit.errors ? `\n**Audit issues:**\n${audit.violations.filter((v) => v.severity === 'error').slice(0, 10).map((v) => `- ${v.file}:${v.line} [${v.rule}] ${v.message}`).join('\n')}` : '',
    '',
  ].join('\n');
  await emitSummary(md);
}


main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
