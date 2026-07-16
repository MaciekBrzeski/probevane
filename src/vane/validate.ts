import type { CommandDecl, Decl, VaneError, VaneFile } from './ast.js';

// Vane structural validation — everything that's checkable without knowing the
// consumer's tables (profile-token resolution lives in the profiles codegen,
// which owns the closed rune/segment tables). Returns errors, never throws:
// the lint mode wants ALL problems, the loaders decide fatality.

/** Duplicate declaration names within one kind — the exact bug class the old
 *  catalog had (duplicate `visual` entries the Set-based gate never saw). */
function dupErrors(decls: Decl[]): VaneError[] {
  const seen = new Map<string, Decl>();
  const out: VaneError[] = [];
  for (const d of decls) {
    const key = `${d.kind}:${d.name}`;
    const prev = seen.get(key);
    if (prev) out.push({ message: `duplicate ${d.kind} '${d.name}' (first at line ${prev.pos.line})`, pos: d.pos });
    else seen.set(key, d);
  }
  return out;
}

/** Flag-level checks: dup names, bool-with-default. */
function flagErrors(d: CommandDecl): VaneError[] {
  const out: VaneError[] = [];
  const seen = new Set<string>();
  for (const f of d.flags) {
    if (seen.has(f.name)) out.push({ message: `duplicate flag --${f.name}`, pos: f.pos });
    seen.add(f.name);
    if (f.type === 'bool' && f.def !== undefined)
      out.push({ message: `bool flag --${f.name} cannot take a default (presence IS the value)`, pos: f.pos });
  }
  return out;
}

/** Variadic-arg constraints: at most one, it must be last, and not alongside dir
 *  (both would fight over trailing positionals). */
function variadicErrors(d: CommandDecl): VaneError[] {
  const out: VaneError[] = [];
  const idx = d.args.findIndex((a) => a.variadic);
  if (idx === -1) return out;
  const v = d.args[idx];
  if (idx !== d.args.length - 1) out.push({ message: `variadic arg '${v.name}' must be the last positional`, pos: v.pos });
  if (d.args.filter((a) => a.variadic).length > 1) out.push({ message: `only one variadic arg allowed`, pos: v.pos });
  if (d.dir) out.push({ message: `variadic arg '${v.name}' cannot coexist with dir (both eat trailing positionals)`, pos: v.pos });
  return out;
}

/** Command-level checks: catalog fields present, spec shape coherent. */
function commandErrors(d: CommandDecl): VaneError[] {
  const out: VaneError[] = variadicErrors(d);
  for (const field of ['summary', 'usage', 'example'] as const) {
    if (!d[field]) out.push({ message: `command '${d.name}' missing ${field}`, pos: d.pos });
  }
  if (d.handler && !d.dir && d.args.length === 0 && d.flags.length === 0) {
    out.push({ message: `command '${d.name}' has a handler but no dir/arg/flag spec`, pos: d.pos });
  }
  return [...out, ...flagErrors(d)];
}

/** Alias targets must name a declared profile. */
function aliasErrors(ast: VaneFile): VaneError[] {
  const profiles = new Set(ast.decls.filter((d) => d.kind === 'profile').map((d) => d.name));
  return ast.decls
    .filter((d) => d.kind === 'alias' && !profiles.has(d.target))
    .map((d) => ({ message: `alias '${d.name}' targets unknown profile '${(d as { target: string }).target}'`, pos: d.pos }));
}

/** Full structural validation of one parsed file. */
export function validateVane(ast: VaneFile): VaneError[] {
  const out = dupErrors(ast.decls);
  for (const d of ast.decls) if (d.kind === 'command') out.push(...commandErrors(d));
  out.push(...aliasErrors(ast));
  return out;
}
