import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The probevane command surface — now LOADED from vane/commands.vane (the
// declarative Vane source of truth). This module keeps the same exported API
// (COMMANDS/UNDOCUMENTED/binCommands) so the skill generator, gates and tests
// are untouched. Add a command in commands.vane AND bin/probevane, or the
// bijection gate fails — that's what keeps the skill auto-in-sync.

export interface Command {
  name: string;
  summary: string;
  usage: string;
  example: string;
}

import { loadCommands } from '../../vane/load.js';

/** The full command surface, in vane-file order (= SKILL.md order). */
export const COMMANDS: Command[] = loadCommands().map((d) => ({
  name: d.name, summary: d.summary, usage: d.usage, example: d.example,
}));

/** Commands accepted by bin/probevane that intentionally aren't user-facing skill entries. */
export const UNDOCUMENTED = new Set(['version', '-v', '--version', 'help', '-h', '--help']);

/** Parse the command names the bin dispatcher accepts (the `a|b|c)` case line). */
export async function binCommands(): Promise<string[]> {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'probevane');
  const src = await readFile(bin, 'utf8');
  const m = src.match(/^\s*(init\|[a-z0-9|-]+)\)/m);
  return m ? m[1].split('|') : [];
}
