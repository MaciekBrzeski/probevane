import { resolve } from 'node:path';

// Shared argv helpers for src/cli/*.ts — the exact copy-pasted pattern each
// command used locally. Semantics match the dominant local implementations
// byte-for-byte; commands with divergent variants keep their own copy.

/** Value following `name` in argv (`--flag value`), or undefined when the flag is absent. */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Integer value of `--flag N`; `dflt` when the flag is absent or its value is not a number. */
export function num(args: string[], name: string, dflt: number): number {
  const n = parseInt(flag(args, name) ?? '', 10);
  return Number.isNaN(n) ? dflt : n;
}

/** First non-`--` positional resolved to an absolute path, defaulting to cwd. */
export function dirArg(args: string[]): string {
  return resolve(args.find((a) => !a.startsWith('--')) ?? '.');
}
