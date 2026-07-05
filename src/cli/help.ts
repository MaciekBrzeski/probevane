import { COMMANDS } from '../commands/skill/catalog.js';

// probevane help [<command>]  ·  probevane <command> --help
//
// Catalog-driven help: src/skill/catalog.ts is the command source of truth
// (drift-gated against bin/probevane + the skill/wiki), so per-command usage is
// always current — no hand-maintained heredoc to go stale. The dispatcher
// routes `help <cmd>` and any `<cmd> -h/--help` here.
function main() {
  const name = process.argv[2];
  const hit = name ? COMMANDS.find((c) => c.name === name) : undefined;
  if (hit) {
    console.log(`probevane ${hit.name} — ${hit.summary}\n`);
    console.log(`Usage:   ${hit.usage}`);
    console.log(`Example: ${hit.example}`);
    return;
  }
  if (name) console.log(`probevane: no such command '${name}' — full list:\n`);
  else console.log('Probevane — agentic harness that adds unit + e2e tests to a project\n');
  const pad = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  for (const c of COMMANDS) {
    const first = c.summary.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
    console.log(`  ${c.name.padEnd(pad)}${first}`);
  }
  console.log('\nDetails: probevane help <command>   ·   probevane <command> --help');
  console.log('Library: ~/.local/share/probevane/ (personal, cross-project)');
}

main();
