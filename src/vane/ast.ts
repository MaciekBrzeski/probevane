// Vane AST — the parsed shape of .vane files (the repo's small declarative
// language: command specs, rune-profile compositions, adapter manifests).
// Pure types; parse.ts builds them, validate.ts checks them, the loaders and
// the profiles codegen consume them.

/** Where a construct came from — every error message carries one. */
export interface Pos {
  file: string;
  line: number; // 1-based
}

/** Flag value shapes. `str?` = valued-optional: flag present without a value
 *  parses to '' (the `graph --mermaid` sentinel); `list` = comma-split. */
export type FlagType = 'bool' | 'int' | 'num' | 'str' | 'str?' | 'list';

/** One `flag --name type [= default] "doc"` line. */
export interface FlagSpec {
  name: string; // without the -- prefix
  type: FlagType;
  def?: string; // raw default token (typed at parse time by the interpreter)
  doc: string;
  pos: Pos;
}

/** One `arg name type "doc"` line — extra positionals consumed before `dir`. */
export interface ArgSpec {
  name: string;
  doc: string;
  pos: Pos;
}

/** `handler module#export` — the function a migrated command dispatches to. */
export interface HandlerRef {
  module: string; // resolved as src/commands/<module>.js
  export: string;
}

/** One `command` declaration. Data fields (summary/usage/example) always feed
 *  the skill catalog; the spec fields (dir/args/flags/handler) exist only for
 *  interpreted commands — their absence marks a catalog-only (legacy) entry. */
export interface CommandDecl {
  kind: 'command';
  name: string;
  pos: Pos;
  summary: string;
  usage: string;
  example: string;
  dir: boolean; // accepts the canonical positional dir (default '.')
  args: ArgSpec[];
  flags: FlagSpec[];
  handler?: HandlerRef;
}

/** One segment line inside a profile: `[if key:] segment-id token*`. Tokens
 *  resolve against the codegen's CLOSED tables — unknown token = parse error. */
export interface SegmentLine {
  id: string;
  tokens: string[];
  cond?: string; // opts key gating the whole segment (`if render:`)
  pos: Pos;
}

/** One `profile` declaration — the top-layer rune pipeline composition. */
export interface ProfileDecl {
  kind: 'profile';
  name: string;
  segments: SegmentLine[];
  pos: Pos;
}

/** `alias fix = repair` — a profile name sharing another's pipeline. */
export interface AliasDecl {
  kind: 'alias';
  name: string;
  target: string;
  pos: Pos;
}

/** One `adapter` manifest — the DATA fields of a StackAdapter. Partial by
 *  design: anything absent stays defined in the adapter's TS. */
export interface AdapterDecl {
  kind: 'adapter';
  name: string;
  pos: Pos;
  commands: Record<string, string>; // key → raw shell string
  patterns: Record<string, string>; // kind → prompt filename
  auditRules?: string; // named ruleset ref, resolved via a TS registry
  guidance: Record<string, string>; // kind → dedented prose block
}

export type Decl = CommandDecl | ProfileDecl | AliasDecl | AdapterDecl;

/** One parsed .vane file. */
export interface VaneFile {
  file: string;
  decls: Decl[];
}

/** A parse/validate problem, always positioned. */
export interface VaneError {
  message: string;
  pos: Pos;
}

/** Render an error the way tsc does: `vane/commands.vane:41: message`. */
export function formatVaneError(e: VaneError): string {
  return `${e.pos.file}:${e.pos.line}: ${e.message}`;
}
