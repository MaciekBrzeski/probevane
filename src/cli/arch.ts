import { resolve, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { archCritique } from '../arch/critique.js';
import { dirArg } from './args.js';

// probevane arch <dir> [--no-llm] [--folder-only] [--snapshot [--out <file>]]
//
// Experimental architecture critique: render the folder tree + dependency tree +
// directory coupling metrics, then ask an LLM ($0 ollama) what could be
// structurally better. Report-only — never edits. Model via PROBEVANE_ARCH_MODEL
// (default glm-5.2), endpoint PROBEVANE_ARCH_BASE (default ollama cloud).
// --snapshot: persist the coupling metrics (docs/arch-snapshot.json) and print
// drift vs the previous snapshot — the committed file makes coupling
// regressions visible over time. Still report-only, never a gate.
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const llm = !args.includes('--no-llm') && !args.includes('--folder-only') && !args.includes('--snapshot');

  if (args.includes('--snapshot')) return snapshot(dir, args);

  const report = await archCritique(dir, { llm });
  console.log(`# Architecture critique — ${dir}`);
  console.log(`\n_${report.depSummary}_\n`);
  console.log('## Folder structure\n```');
  console.log(report.folderTree);
  console.log('```');
  console.log('\n## Shared hubs (imported by >=8)');
  for (const h of report.hubs) console.log(`- ${h.path.replace(/^src\//, '')} (${h.importedBy})`);
  console.log('\n## Directory metrics\n' + report.digest);
  if (report.findings) {
    console.log(`\n## Findings (${report.model})\n`);
    console.log(report.findings);
  }
}

async function snapshot(dir: string, args: string[]) {
  const { buildGraph } = await import('../mock/graph.js');
  const { archMetrics, archDrift } = await import('../arch/metrics.js');
  const i = args.indexOf('--out');
  const out = resolve(i >= 0 && args[i + 1] ? args[i + 1] : join(dir, 'docs', 'arch-snapshot.json'));
  const metrics = archMetrics(await buildGraph(dir));

  const prevTxt = await readFile(out, 'utf8').catch(() => '');
  if (prevTxt) {
    const drift = archDrift(JSON.parse(prevTxt).metrics, metrics);
    console.log(drift.length ? `## Drift vs ${out}\n` + drift.map((l) => `  ${l}`).join('\n') : '[probevane] no drift');
  }
  await writeFile(out, JSON.stringify({ metrics }, null, 2) + '\n');
  console.log(`[probevane] arch snapshot → ${out} (${metrics.dirs.length} dirs, ${metrics.edges.length} edges, ${metrics.cycles.length} cycles)`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
