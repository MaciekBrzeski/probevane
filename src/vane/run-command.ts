import { resolve } from 'node:path';
import type { CommandDecl, FlagSpec } from './ast.js';
import { loadCommands } from './load.js';

// The Vane command interpreter — replaces each migrated CLI shell's hand-rolled
// argv scaffold. A shell becomes a 2-line trampoline calling runVaneCommand();
// the spec in vane/commands.vane drives typed flag parsing (same semantics as
// util/args.ts dirArg/flag/positionals) and dispatches to the handler function.

/** What a handler receives: the resolved target dir, declared positionals by
 *  name, typed flag values, and the raw argv for anything exotic. */
export interface CommandCtx {
  dir: string;
  args: Record<string, string>;
  flags: Record<string, string | number | boolean | string[] | undefined>;
  argv: string[];
}

/** A handler exported from src/commands/<module>.ts. Exit codes via process.exit,
 *  exactly like the shells it replaces. */
export type CommandHandler = (ctx: CommandCtx) => Promise<void>;

/** Does this flag consume the next argv token as its value? `str?` consumes one
 *  only when the next token isn't another flag (the bare-flag '' sentinel). */
function takesValue(f: FlagSpec, next: string | undefined): boolean {
  if (f.type === 'bool') return false;
  if (f.type === 'str?') return next !== undefined && !next.startsWith('--');
  return true;
}

/** Type one raw flag value per the spec ('' = bare str?, undefined = absent). */
function typeValue(f: FlagSpec, raw: string | undefined): CommandCtx['flags'][string] {
  if (f.type === 'bool') return raw !== undefined;
  if (raw === undefined) raw = f.def;
  if (raw === undefined) return undefined;
  if (f.type === 'int' || f.type === 'num') {
    const n = f.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (f.type === 'list') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw; // str, str? (bare str? arrives as '')
}

/** Parse argv against the spec → ctx. Positionals = tokens that are neither a
 *  declared flag nor a declared flag's value; declared `arg`s consume them in
 *  order, then `dir` takes the next (default '.', resolved absolute). */
export function parseArgv(decl: CommandDecl, argv: string[]): CommandCtx {
  const byName = new Map(decl.flags.map((f) => [`--${f.name}`, f]));
  const raw = new Map<string, string | undefined>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const f = byName.get(argv[i]);
    if (!f) {
      if (!argv[i].startsWith('--')) positionals.push(argv[i]);
      continue; // undeclared --flags are tolerated noise, same as the old shells
    }
    if (takesValue(f, argv[i + 1])) raw.set(f.name, argv[++i]);
    else raw.set(f.name, f.type === 'str?' ? '' : 'true');
  }
  const flags: CommandCtx['flags'] = {};
  for (const f of decl.flags) flags[f.name] = typeValue(f, raw.has(f.name) ? (raw.get(f.name) ?? '') : undefined);
  const args: Record<string, string> = {};
  decl.args.forEach((a, i) => { args[a.name] = positionals[i] ?? ''; });
  const dir = decl.dir ? resolve(positionals[decl.args.length] ?? '.') : process.cwd();
  return { dir, args, flags, argv };
}

/** Entry used by every migrated shell: load the spec, parse argv, dispatch to
 *  the handler, keep the classic main().catch exit-1 contract. */
export function runVaneCommand(name: string): void {
  void (async () => {
    const decl = loadCommands().find((c) => c.name === name);
    if (!decl?.handler) throw new Error(`vane: command '${name}' has no handler spec in vane/commands.vane`);
    const ctx = parseArgv(decl, process.argv.slice(2));
    const mod = await import(`../commands/${decl.handler.module}.js`);
    const handler = mod[decl.handler.export] as CommandHandler | undefined;
    if (!handler) throw new Error(`vane: handler ${decl.handler.module}#${decl.handler.export} not found`);
    await handler(ctx);
  })().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
