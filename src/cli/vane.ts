import { formatVaneError } from '../vane/ast.js';
import { parseVane } from '../vane/parse.js';
import { validateVane } from '../vane/validate.js';
import { vaneRoot } from '../vane/load.js';
import { generateProfiles } from '../vane/gen-profiles.js';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// probevane vane [--check | --write]
//
// Lint every shipped .vane file (parse + structural validation, tsc-style
// file:line errors), then handle the GENERATED artifacts:
//   --write  regenerate src/loop/profiles.gen.ts + docs/wiki/pipeline-model.json
//   --check  byte-compare both against a fresh in-memory generation (CI gate)
// Plain run = lint only.

/** Every .vane file under the vane root (commands, profiles, adapters/*). */
function vaneFiles(): string[] {
  const root = vaneRoot();
  const out: string[] = [];
  for (const name of ['commands.vane', 'profiles.vane']) {
    if (existsSync(join(root, name))) out.push(name);
  }
  const adaptersDir = join(root, 'adapters');
  if (existsSync(adaptersDir)) {
    for (const f of readdirSync(adaptersDir).filter((f) => f.endsWith('.vane'))) out.push(join('adapters', f));
  }
  return out;
}

/** Lint one file; returns formatted errors (empty = clean). */
function lintFile(rel: string): string[] {
  const source = readFileSync(join(vaneRoot(), rel), 'utf8');
  const { ast, errors } = parseVane(source, `vane/${rel}`);
  return [...errors, ...validateVane(ast)].map(formatVaneError);
}

/** The two generated artifacts: repo path + fresh in-memory content. */
async function artifacts(): Promise<{ path: string; content: string }[]> {
  const root = join(vaneRoot(), '..');
  const { fullModel } = await import('../loop/describe.js');
  return [
    { path: join(root, 'src', 'loop', 'profiles.gen.ts'), content: generateProfiles() },
    { path: join(root, 'docs', 'wiki', 'pipeline-model.json'), content: JSON.stringify(fullModel(), null, 2) + '\n' },
  ];
}

/** --check: byte-compare each artifact; --write: rewrite them. Exit 1 on drift. */
async function handleArtifacts(mode: 'check' | 'write'): Promise<void> {
  for (const a of await artifacts()) {
    if (mode === 'write') {
      writeFileSync(a.path, a.content);
      console.log(`[probevane] vane: wrote ${a.path}`);
      continue;
    }
    const current = existsSync(a.path) ? readFileSync(a.path, 'utf8') : '';
    if (current !== a.content) {
      console.error(`[probevane] vane: ${a.path} is stale — run \`probevane vane --write\` and commit`);
      process.exit(1);
    }
  }
  if (mode === 'check') console.log('[probevane] vane: generated artifacts in sync');
}

/** Entry: lint all vane files; then --check/--write the generated artifacts. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = vaneFiles();
  if (!files.length) {
    console.error(`[probevane] vane: no .vane files under ${vaneRoot()}`);
    process.exit(1);
  }
  const errors = files.flatMap(lintFile);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`[probevane] vane: ${errors.length} error(s) in ${files.length} file(s)`);
    process.exit(1);
  }
  console.log(`[probevane] vane: ${files.length} file(s) clean (${files.join(', ')})`);
  if (args.includes('--write')) return handleArtifacts('write');
  if (args.includes('--check')) return handleArtifacts('check');
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
