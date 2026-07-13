import type {
  AdapterDecl, AliasDecl, CommandDecl, Decl, FlagSpec, FlagType, Pos, ProfileDecl, VaneError, VaneFile,
} from './ast.js';
import { lex, type LexLine } from './lex.js';

// Vane parser — logical lines → declarations. One small handler per line form,
// dispatched by leading keyword; anything unrecognized is a positioned error,
// never silently skipped (a typo'd flag line must not vanish from a command).

/** Parser state threaded through the handlers: the line stream + error sink. */
interface P {
  lines: LexLine[];
  i: number;
  file: string;
  errors: VaneError[];
}

const at = (p: P): LexLine => p.lines[p.i];
const posOf = (p: P, l: LexLine): Pos => ({ file: p.file, line: l.line });
/** Record a positioned error against a line. */
const err = (p: P, l: LexLine, message: string): void => {
  p.errors.push({ message, pos: posOf(p, l) });
};

const FLAG_RE = /^--([a-z][a-z0-9-]*)\s+(bool|int|num|str\?|str|list)(?:\s*=\s*(\S+))?(?:\s+"([^"]*)")?$/;
const HANDLER_RE = /^([\w/-]+)#(\w+)$/;

/** Parse one `flag …` body line into a FlagSpec, or record why it isn't one. */
function parseFlag(p: P, l: LexLine, rest: string): FlagSpec | null {
  const m = rest.match(FLAG_RE);
  if (!m) {
    err(p, l, `bad flag line — expected: flag --name bool|int|num|str|str?|list [= default] ["doc"]`);
    return null;
  }
  return { name: m[1], type: m[2] as FlagType, def: m[3], doc: m[4] ?? '', pos: posOf(p, l) };
}

/** Parse one `arg …` body line onto the command. */
function parseArg(p: P, d: CommandDecl, l: LexLine, rest: string): void {
  const m = rest.match(/^(\w+)\s+str(?:\s+"([^"]*)")?$/);
  if (m) d.args.push({ name: m[1], doc: m[2] ?? '', pos: posOf(p, l) });
  else err(p, l, 'bad arg line — expected: arg <name> str ["doc"]');
}

/** Parse one `handler …` body line onto the command. */
function parseHandler(p: P, d: CommandDecl, l: LexLine, rest: string): void {
  const m = rest.match(HANDLER_RE);
  if (m) d.handler = { module: m[1], export: m[2] };
  else err(p, l, 'bad handler ref — expected: handler <module>#<export>');
}

/** Body-line handlers for a `command` declaration, one per field keyword. */
const COMMAND_FIELDS: Record<string, (p: P, d: CommandDecl, l: LexLine, rest: string) => void> = {
  summary: (_p, d, _l, rest) => { d.summary = rest; },
  usage: (_p, d, _l, rest) => { d.usage = rest; },
  example: (_p, d, _l, rest) => { d.example = rest; },
  dir: (_p, d) => { d.dir = true; },
  arg: parseArg,
  flag: (p, d, l, rest) => { const f = parseFlag(p, l, rest); if (f) d.flags.push(f); },
  handler: parseHandler,
};

/** Dispatch one command body line to its field handler. */
function commandBodyLine(p: P, d: CommandDecl, l: LexLine): void {
  const sp = l.text.indexOf(' ');
  const kw = sp === -1 ? l.text : l.text.slice(0, sp);
  const rest = sp === -1 ? '' : l.text.slice(sp + 1).trim();
  const handle = COMMAND_FIELDS[kw];
  if (handle) handle(p, d, l, rest);
  else err(p, l, `unknown command field '${kw}'`);
}

/** Body-line handler for a `profile` declaration (`[if key:] id token*`). */
function profileBodyLine(p: P, d: ProfileDecl, l: LexLine): void {
  let text = l.text;
  let cond: string | undefined;
  const condM = text.match(/^if\s+(\w+):\s*(.*)$/);
  if (condM) { cond = condM[1]; text = condM[2]; }
  const [id, ...tokens] = text.split(/\s+/).filter(Boolean);
  if (!id) { err(p, l, 'empty profile segment line'); return; }
  d.segments.push({ id, tokens, cond, pos: posOf(p, l) });
}

/** Collect a deeper-indented guidance block, dedented + newline-joined. */
function collectBlock(p: P, minIndent: number): string {
  const out: string[] = [];
  while (p.i < p.lines.length && at(p).indent >= minIndent) {
    out.push(at(p).text);
    p.i++;
  }
  return out.join('\n');
}

/** Body-line handlers for an `adapter` manifest. */
function adapterBodyLine(p: P, d: AdapterDecl, l: LexLine): void {
  let m = l.text.match(/^command\s+([\w-]+)\s*=\s*(.+)$/);
  if (m) { d.commands[m[1]] = m[2]; return; }
  m = l.text.match(/^patterns\s+(\w+)\s*=\s*(\S+)$/);
  if (m) { d.patterns[m[1]] = m[2]; return; }
  m = l.text.match(/^audit-rules\s*=\s*(\w+)$/);
  if (m) { d.auditRules = m[1]; return; }
  m = l.text.match(/^guidance\s+(\w+):$/);
  if (m) {
    p.i++; // step past the header; collectBlock consumes the indented body
    d.guidance[m[1]] = collectBlock(p, l.indent + 2);
    p.i--; // main loop advances once per body line
    return;
  }
  err(p, l, `unknown adapter field: ${l.text.split(/\s+/)[0]}`);
}

/** Consume one declaration's body (indent 2 lines) with the given handler. */
function parseBody<T>(p: P, decl: T, handle: (p: P, d: T, l: LexLine) => void): void {
  while (p.i < p.lines.length && at(p).indent >= 2) {
    handle(p, decl, at(p));
    p.i++;
  }
}

/** Parse one top-level declaration line; returns the decl or null on error. */
function parseDecl(p: P, l: LexLine): Decl | null {
  const pos = posOf(p, l);
  let m = l.text.match(/^command\s+([\w-]+)$/);
  if (m) {
    const d: CommandDecl = {
      kind: 'command', name: m[1], pos, summary: '', usage: '', example: '',
      dir: false, args: [], flags: [],
    };
    p.i++;
    parseBody(p, d, commandBodyLine);
    return d;
  }
  m = l.text.match(/^profile\s+([\w-]+)$/);
  if (m) {
    const d: ProfileDecl = { kind: 'profile', name: m[1], segments: [], pos };
    p.i++;
    parseBody(p, d, profileBodyLine);
    return d;
  }
  m = l.text.match(/^alias\s+([\w-]+)\s*=\s*([\w-]+)$/);
  if (m) {
    p.i++;
    return { kind: 'alias', name: m[1], target: m[2], pos } satisfies AliasDecl;
  }
  m = l.text.match(/^adapter\s+([\w-]+)$/);
  if (m) {
    const d: AdapterDecl = { kind: 'adapter', name: m[1], pos, commands: {}, patterns: {}, guidance: {} };
    p.i++;
    parseBody(p, d, adapterBodyLine);
    return d;
  }
  err(p, l, `unknown declaration '${l.text.split(/\s+/)[0]}' — expected command|profile|alias|adapter`);
  p.i++;
  return null;
}

/** Parse a .vane source. Returns every declaration it could read plus every
 *  positioned error — the caller decides whether errors are fatal (loaders
 *  hard-throw; the lint mode prints them all). */
export function parseVane(source: string, file: string): { ast: VaneFile; errors: VaneError[] } {
  const { lines, errors } = lex(source, file);
  const p: P = { lines, i: 0, file, errors };
  const decls: Decl[] = [];
  while (p.i < p.lines.length) {
    const l = at(p);
    if (l.indent !== 0) {
      err(p, l, 'unexpected indented line outside a declaration');
      p.i++;
      continue;
    }
    const d = parseDecl(p, l);
    if (d) decls.push(d);
  }
  return { ast: { file, decls }, errors: p.errors };
}
