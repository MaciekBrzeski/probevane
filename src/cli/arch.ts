import { resolve } from 'node:path';
import { archCritique } from '../arch/critique.js';

// probevane arch <dir> [--no-llm] [--folder-only]
//
// Experimental architecture critique: render the folder tree + dependency tree +
// directory coupling metrics, then ask an LLM ($0 ollama) what could be
// structurally better. Report-only — never edits. Model via PROBEVANE_ARCH_MODEL
// (default glm-5.2), endpoint PROBEVANE_ARCH_BASE (default ollama cloud).
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const llm = !args.includes('--no-llm') && !args.includes('--folder-only');

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

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
