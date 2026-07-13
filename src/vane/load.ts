import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterDecl, CommandDecl, ProfileDecl, AliasDecl, VaneFile } from './ast.js';
import { formatVaneError } from './ast.js';
import { parseVane } from './parse.js';
import { validateVane } from './validate.js';

// Vane loaders — resolve the shipped vane/ directory, parse + validate, and
// HARD-THROW on any problem with file:line. Never a silent '' fallback: a
// broken vane file bricking a command loudly beats a command quietly running
// with half its spec (the loadPrompt silent-empty bug is the anti-pattern).

/** vane/ root: $PROBEVANE_ROOT when bin exported it, else relative to this
 *  module — works from both src/vane (tsx dev) and dist/vane (published). */
export function vaneRoot(): string {
  const env = process.env.PROBEVANE_ROOT;
  if (env) return join(env, 'vane');
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vane');
}

const cache = new Map<string, VaneFile>();

/** Read + parse + validate one .vane file (memoized); throws listing every
 *  positioned error when anything is wrong. */
export function loadVaneFile(relPath: string): VaneFile {
  const hit = cache.get(relPath);
  if (hit) return hit;
  const abs = join(vaneRoot(), relPath);
  let source: string;
  try {
    source = readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`vane: cannot read ${abs} — is vane/ shipped next to the package root?`);
  }
  const { ast, errors } = parseVane(source, `vane/${relPath}`);
  const all = [...errors, ...validateVane(ast)];
  if (all.length) throw new Error(`vane: ${all.length} error(s)\n${all.map(formatVaneError).join('\n')}`);
  cache.set(relPath, ast);
  return ast;
}

/** Test seam: clear the memo (tests parse temp roots via PROBEVANE_ROOT). */
export function clearVaneCache(): void {
  cache.clear();
}

/** All command declarations, in file order (SKILL.md order = file order). */
export function loadCommands(): CommandDecl[] {
  return loadVaneFile('commands.vane').decls.filter((d): d is CommandDecl => d.kind === 'command');
}

/** Profiles + aliases from profiles.vane (consumed by the profiles codegen). */
export function loadProfiles(): { profiles: ProfileDecl[]; aliases: AliasDecl[] } {
  const decls = loadVaneFile('profiles.vane').decls;
  return {
    profiles: decls.filter((d): d is ProfileDecl => d.kind === 'profile'),
    aliases: decls.filter((d): d is AliasDecl => d.kind === 'alias'),
  };
}

/** One adapter's manifest, or null when the stack has none (fully-TS adapter). */
export function loadAdapterManifest(id: string): AdapterDecl | null {
  try {
    const decls = loadVaneFile(join('adapters', `${id}.vane`)).decls;
    return decls.find((d): d is AdapterDecl => d.kind === 'adapter' && d.name === id) ?? null;
  } catch (e) {
    if (String(e).includes('cannot read')) return null; // no manifest = TS-only adapter
    throw e; // parse/validate errors stay fatal
  }
}
