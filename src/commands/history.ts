import { readRuns, summarize } from '../cost/ledger.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts, shouldHalt } from '../observe/alerts.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane history` backend — run history + cost ledger: total spend, how
// much the harness landed on its own vs needed a stronger-model takeover vs
// needed hand-finishing, and the per-model / per-path breakdown. Reads
// ~/.local/share/probevane/runs.jsonl. --trend: daily time-series + the
// daemon's cost/acceptance alerts, in the CLI. Logic moved verbatim from the
// old src/cli/history.ts shell; the vane interpreter owns argv.

/** Print the ledger summary (or the --json / --trend views). */
export async function run(ctx: CommandCtx): Promise<void> {
  const limit = (ctx.flags.limit as number | undefined) ?? 12;
  const runs = await readRuns();
  if (ctx.flags.trend === true) return trend(runs, ctx);
  if (ctx.flags.json === true) { console.log(JSON.stringify(summarize(runs), null, 2)); return; }
  if (!runs.length) { console.log('[probevane] no runs recorded yet (PROBEVANE_LEDGER=0 disables; runs append automatically).'); return; }

  const s = summarize(runs);
  const $ = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const pct = (n: number) => `${Math.round((n / s.runs) * 100)}%`;

  console.log(`### 💰 probevane history — ${s.runs} run(s), ${$(s.totalCost)} total`);
  console.log('');
  console.log(`- tokens: ${s.totalTokensIn.toLocaleString()} in / ${s.totalTokensOut.toLocaleString()} out`);
  if (s.avgDurationMs > 0) console.log(`- avg run duration: ${(s.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`- accepted: ${s.accepted}/${s.runs} (${pct(s.accepted)})`);
  console.log(`- **by the harness alone**: ${s.harnessOnly} (${pct(s.harnessOnly)}) · **needed takeover**: ${s.withTakeover} (${pct(s.withTakeover)}) · **needed hand**: ${s.needsHand} (${pct(s.needsHand)})`);
  console.log('\n**By model**');
  for (const [m, v] of Object.entries(s.byModel).sort((a, b) => b[1].cost - a[1].cost))
    console.log(`  ${m.padEnd(28)} ${String(v.runs).padStart(3)} runs  ${$(v.cost)}`);
  console.log('\n**By path**');
  for (const [p, v] of Object.entries(s.byPath).sort((a, b) => b[1].runs - a[1].runs))
    console.log(`  ${p.padEnd(16)} ${String(v.runs).padStart(3)} runs  ${v.accepted}/${v.runs} accepted  ${$(v.cost)}`);

  console.log(`\n**Recent runs** (last ${limit})`);
  for (const r of runs.slice(-limit).reverse()) {
    const tag = r.accepted ? (r.tookOver ? '✅↑' : '✅') : '✗';
    console.log(`  ${r.ts.slice(5, 16).replace('T', ' ')}  ${tag.padEnd(3)} ${r.label.padEnd(26)} ${r.model.replace('claude-', '').padEnd(16)} ${$(r.cost).padStart(8)}  ${r.stopReason}`);
  }
}

// Daily table + alerts — the daemon's aggregate/alert cores, surfaced in the CLI.
function trend(runs: Awaited<ReturnType<typeof readRuns>>, ctx: CommandCtx) {
  const days = (ctx.flags.days as number | undefined) ?? 14;
  const overTime = aggregateOverTime(runs);
  const daily = overTime.daily.slice(-days);
  const alerts = computeAlerts(overTime.daily);
  if (ctx.flags.json === true) {
    console.log(JSON.stringify({ overTime: { ...overTime, daily }, alerts, halt: shouldHalt(alerts) }, null, 2));
    return;
  }
  if (!daily.length) { console.log('[probevane] no runs recorded yet.'); return; }
  console.log(`### 📈 probevane trend — last ${daily.length} day(s)`);
  console.log('');
  console.log('  date        runs  accepted   cost      tokens in/out');
  for (const d of daily) {
    console.log(
      `  ${d.date}  ${String(d.runs).padStart(4)}  ${`${d.accepted}/${d.runs}`.padStart(8)}  ` +
      `$${d.cost.toFixed(2).padStart(7)}  ${d.tokensIn.toLocaleString()}/${d.tokensOut.toLocaleString()}`,
    );
  }
  if (alerts.length) {
    console.log('\n**Alerts**');
    for (const a of alerts) console.log(`  ${a.severity === 'error' ? '🛑' : '⚠️'} ${a.kind}: ${a.message}`);
    if (shouldHalt(alerts)) console.log('  → circuit-breaker: the daemon queue would HALT on this state');
  } else {
    console.log('\nno alerts');
  }
}
