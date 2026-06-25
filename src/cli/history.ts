import { readRuns, summarize } from '../cost/ledger.js';

// probevane history [--limit N] [--json]
//
// Run history + cost ledger: total spend, how much the harness landed on its
// own vs needed a stronger-model takeover vs needed hand-finishing, and the
// per-model / per-path breakdown. Reads ~/.local/share/probevane/runs.jsonl.
async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(flag(args, '--limit') ?? '12', 10);
  const runs = await readRuns();
  if (args.includes('--json')) { console.log(JSON.stringify(summarize(runs), null, 2)); return; }
  if (!runs.length) { console.log('[probevane] no runs recorded yet (PROBEVANE_LEDGER=0 disables; runs append automatically).'); return; }

  const s = summarize(runs);
  const $ = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const pct = (n: number) => `${Math.round((n / s.runs) * 100)}%`;

  console.log(`### 💰 probevane history — ${s.runs} run(s), ${$(s.totalCost)} total`);
  console.log('');
  console.log(`- tokens: ${s.totalTokensIn.toLocaleString()} in / ${s.totalTokensOut.toLocaleString()} out`);
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

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
