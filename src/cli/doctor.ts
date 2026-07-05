import { runDoctor } from '../commands/doctor/checks.js';
import { selectAdapter } from '../adapters/registry.js';
import { dirArg } from './args.js';

// probevane doctor <dir> [--fix] [--full] [--json]
//
// Detect (and with --fix, repair) the failure classes that silently degrade a
// harness setup: broken toolchains + missing deps/browsers, coverage blind
// spots + stale reports, git-tracked test artifacts, package-manifest lies,
// invalid config, missing credentials, CI steps that swallow failures, stale
// replay cassettes, eval-case bijection. Each check exists because it bit for
// real — see src/commands/doctor/checks.ts for provenance. --full appends a one-screen
// scorecard from the read-only graders (audit / assertions / coverage /
// quality / arch). Exit 1 when unfixed errors remain.
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const fix = args.includes('--fix');
  const full = args.includes('--full');

  const adapter = await selectAdapter(dir);
  const report = await runDoctor(dir, adapter ?? undefined);
  const fullLines = full ? await (await import('../commands/doctor/full.js')).fullReport(dir, adapter ?? undefined) : null;

  if (args.includes('--json')) {
    const out = { findings: report.findings, fixable: report.fixes.length, full: fullLines ?? undefined };
    console.log(JSON.stringify(out, null, 2));
    process.exit(report.findings.some((f) => f.severity === 'error') ? 1 : 0);
  }

  if (!report.findings.length) {
    console.log(`[probevane] doctor: healthy (${adapter ? adapter.id : 'no adapter detected'})`);
  } else {
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
  }

  if (fullLines) {
    console.log('\n### 📋 graders (read-only)\n');
    const pad = Math.max(...fullLines.map((l) => l.area.length)) + 2;
    for (const l of fullLines) console.log(`${l.ok ? '✅' : '❌'} ${l.area.padEnd(pad)}${l.summary}`);
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
