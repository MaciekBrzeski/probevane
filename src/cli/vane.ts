import { formatVaneError } from '../vane/ast.js';
import { parseVane } from '../vane/parse.js';
import { validateVane } from '../vane/validate.js';
import { vaneRoot } from '../vane/load.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// probevane vane [--check]
//
// Lint every shipped .vane file (parse + structural validation, tsc-style
// file:line errors). --check is the CI drift/consistency gate; it will grow
// the profiles.gen.ts byte-compare when the profiles codegen lands. Plain run
// = same checks, human-friendly summary.

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

/** Entry: lint all vane files; exit 1 on any error (works for --check too). */
async function main(): Promise<void> {
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
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
