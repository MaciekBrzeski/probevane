import { runDoctor } from './doctor/checks.js';
import { selectAdapter } from '../adapters/registry.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane doctor` backend — detect (and with --fix, repair) the failure
// classes that silently degrade a harness setup: broken toolchains + missing
// deps/browsers, coverage blind spots + stale reports, git-tracked test
// artifacts, package-manifest lies, invalid config, missing credentials, CI
// steps that swallow failures, stale replay cassettes, eval-case bijection.
// Each check exists because it bit for real — see ./doctor/checks.ts for
// provenance. --full appends a one-screen scorecard from the read-only graders
// (audit / assertions / coverage / quality / arch). Exit 1 when unfixed errors
// remain. Named doctor-cmd (module collides with the ./doctor/ dir, precedent
// plan-cmd); logic moved verbatim from the old src/cli/doctor.ts shell.

/** Print findings with severity tags + fixable hints, then apply --fix repairs.
 *  (Extracted from run() to keep it under the cognitive-complexity bar —
 *  behavior byte-identical to the old shell's inline block.) */
async function printAndFix(report: Awaited<ReturnType<typeof runDoctor>>, fix: boolean): Promise<void> {
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

/** Run the health checks over ctx.dir, print findings (--json for machines),
 *  apply --fix repairs, exit 1 on unfixed errors. */
export async function run(ctx: CommandCtx): Promise<void> {
  const dir = ctx.dir;
  const fix = ctx.flags.fix === true;
  const full = ctx.flags.full === true;

  const adapter = await selectAdapter(dir);
  const report = await runDoctor(dir, adapter ?? undefined);
  const fullLines = full ? await (await import('./doctor/full.js')).fullReport(dir, adapter ?? undefined) : null;

  if (ctx.flags.json === true) {
    const out = { findings: report.findings, fixable: report.fixes.length, full: fullLines ?? undefined };
    console.log(JSON.stringify(out, null, 2));
    process.exit(report.findings.some((f) => f.severity === 'error') ? 1 : 0);
  }

  if (!report.findings.length) {
    console.log(`[probevane] doctor: healthy (${adapter ? adapter.id : 'no adapter detected'})`);
  } else {
    await printAndFix(report, fix);
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
