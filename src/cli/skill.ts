import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkill, buildWikiCommands, SKILL_PATH, WIKI_COMMANDS_PATH } from '../commands/skill/build.js';
import { COMMANDS, UNDOCUMENTED, binCommands } from '../commands/skill/catalog.js';

// probevane skill [--check]
//   (default) regenerate the control skill at .claude/skills/probevane/SKILL.md
//   --check   verify catalog↔bin bijection + no drift; exit 1 if stale (CI gate)
async function main() {
  const root = process.env.PROBEVANE_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const check = process.argv.includes('--check');
  const artifacts = [
    { path: join(root, SKILL_PATH), content: buildSkill(), label: 'SKILL.md' },
    { path: join(root, WIKI_COMMANDS_PATH), content: buildWikiCommands(), label: 'wiki Commands.md' },
  ];

  // Mechanical gate 1: catalog ↔ bin command bijection.
  const bin = new Set(await binCommands());
  const cat = new Set(COMMANDS.map((c) => c.name));
  const documentedMissing = [...cat].filter((c) => !bin.has(c)); // in skill, not dispatchable
  const realUndocumented = [...bin].filter((c) => !cat.has(c) && !UNDOCUMENTED.has(c)); // dispatchable, not in skill

  const errors: string[] = [];
  if (documentedMissing.length) errors.push(`skill documents non-existent command(s): ${documentedMissing.join(', ')}`);
  if (realUndocumented.length) errors.push(`bin has undocumented command(s): ${realUndocumented.join(', ')} (add to src/skill/catalog.ts)`);

  if (check) {
    // Mechanical gate 2: no drift between committed artifacts and freshly generated.
    for (const a of artifacts) {
      const onDisk = await readFile(a.path, 'utf8').catch(() => '');
      if (onDisk !== a.content) errors.push(`${a.label} is stale — run \`probevane skill\` to regenerate`);
    }
    if (errors.length) {
      console.error('[probevane] skill check FAILED:\n- ' + errors.join('\n- '));
      process.exit(1);
    }
    console.log(`[probevane] skill + wiki in sync (${COMMANDS.length} commands)`);
    return;
  }

  if (errors.length) {
    console.error('[probevane] skill bijection issues:\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  for (const a of artifacts) {
    await mkdir(dirname(a.path), { recursive: true });
    await writeFile(a.path, a.content);
  }
  console.log(`[probevane] wrote SKILL.md + wiki Commands.md (${COMMANDS.length} commands)`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
