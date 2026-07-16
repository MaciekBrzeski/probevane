import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv } from '../src/vane/run-command.js';
import { parseVane } from '../src/vane/parse.js';
import { validateVane } from '../src/vane/validate.js';
import { formatVaneError } from '../src/vane/ast.js';
import type { CommandDecl } from '../src/vane/ast.js';
import { dirArg, flag, num } from '../src/util/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal decl builder for parity cases. */
function decl(flags: CommandDecl['flags'], args: CommandDecl['args'] = []): CommandDecl {
  return {
    kind: 'command', name: 't', pos: { file: 't', line: 1 }, summary: 's', usage: 'u', example: 'e',
    dir: true, args, flags,
  };
}
const F = (name: string, type: CommandDecl['flags'][0]['type'], def?: string) =>
  ({ name, type, def, doc: '', pos: { file: 't', line: 1 } });

describe('vane parseArgv — parity with util/args.ts semantics', () => {
  it('dir-first argv: same dir and values as dirArg/flag/num', () => {
    const argv = ['fixtures/react-todo', '--budget', '60', '--only', 'a,b', '--json'];
    const ctx = parseArgv(decl([F('budget', 'int'), F('only', 'list'), F('json', 'bool')]), argv);
    expect(ctx.dir).toBe(dirArg([...argv]));
    expect(ctx.flags.budget).toBe(num([...argv], '--budget'));
    expect(ctx.flags.only).toEqual(flag([...argv], '--only')!.split(','));
    expect(ctx.flags.json).toBe(true);
  });

  it('flag-before-dir argv: interpreter beats legacy dirArg (which grabs the flag VALUE)', () => {
    const argv = ['--budget', '60', 'fixtures/react-todo'];
    // Legacy shells would resolve dir to '60' here — arity-aware parsing fixes it.
    expect(dirArg([...argv])).toBe(resolve('60'));
    const ctx = parseArgv(decl([F('budget', 'int')]), argv);
    expect(ctx.dir).toBe(resolve('fixtures/react-todo'));
    expect(ctx.flags.budget).toBe(60);
  });

  it('str? sentinel: bare flag → "", valued → value, absent → undefined', () => {
    const d = decl([F('mermaid', 'str?')]);
    expect(parseArgv(d, ['--mermaid']).flags.mermaid).toBe('');
    expect(parseArgv(d, ['--mermaid', 'out.md']).flags.mermaid).toBe('out.md');
    expect(parseArgv(d, []).flags.mermaid).toBeUndefined();
    // bare str? followed by another flag still parses as ''
    expect(parseArgv(decl([F('mermaid', 'str?'), F('full', 'bool')]), ['--mermaid', '--full']).flags).toEqual({
      mermaid: '', full: true,
    });
  });

  it('defaults, NaN → undefined, declared args before dir, cwd when no dir', () => {
    const d = decl([F('budget', 'int', '40'), F('rate', 'num')], [{ name: 'prompt', variadic: false, doc: '', pos: { file: 't', line: 1 } }]);
    const ctx = parseArgv(d, ['add tests', 'fixtures/react-todo', '--rate', 'oops']);
    expect(ctx.args.prompt).toBe('add tests');
    expect(ctx.dir).toBe(resolve('fixtures/react-todo'));
    expect(ctx.flags.budget).toBe(40); // default applied
    expect(ctx.flags.rate).toBeUndefined(); // NaN → undefined, never NaN
    const noDir = { ...d, dir: false };
    expect(parseArgv(noDir, []).dir).toBe(process.cwd());
  });
});

describe('vane pilot commands — golden outputs (bin → tsx → interpreter)', () => {
  /** Run one pilot against the fixture, exactly as the P0 capture did. */
  function runPilot(cmd: string): string {
    let out = '';
    let exit = 0;
    try {
      out = execFileSync(join(ROOT, 'bin', 'probevane'), [cmd, 'fixtures/react-todo'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { stdout?: string; status?: number };
      out = err.stdout ?? '';
      exit = err.status ?? 1;
    }
    return `${out}exit=${exit}\n`;
  }

  it.each(['audit', 'graph'])('%s matches its P0 golden byte-for-byte', (cmd) => {
    expect(runPilot(cmd)).toBe(readFileSync(join(ROOT, 'tests', 'golden', `${cmd}.txt`), 'utf8'));
  });
  // coverage golden is exercised too but runs the fixture's vitest (~seconds);
  // keep it in the suite — it's the exit-1 path's only end-to-end proof.
  it('coverage matches its P0 golden byte-for-byte', () => {
    expect(runPilot('coverage')).toBe(readFileSync(join(ROOT, 'tests', 'golden', 'coverage.txt'), 'utf8'));
  });
});

describe('vane dispatchCommand — spec load + handler resolution', () => {
  const saved = process.env.PROBEVANE_ROOT;
  afterEach(() => {
    if (saved === undefined) delete process.env.PROBEVANE_ROOT;
    else process.env.PROBEVANE_ROOT = saved;
  });

  // The happy dispatch path (spec → parseArgv → dynamic-import handler → call)
  // is proven end-to-end by the bin golden tests above; the variable dynamic
  // import isn't statically resolvable under vitest, so unit tests cover the
  // pre-import guards only.
  it('throws for a catalog-only command (no handler spec)', async () => {
    delete process.env.PROBEVANE_ROOT;
    const { dispatchCommand } = await import('../src/vane/run-command.js');
    await expect(dispatchCommand('tui', [])).rejects.toThrow(/no handler spec/);
    await expect(dispatchCommand('does-not-exist', [])).rejects.toThrow(/no handler spec/);
  });
});

/** Parse asserting zero errors. */
function parseVane2(src: string) {
  const { ast, errors } = parseVane(src, "test.vane");
  expect(errors).toEqual([]);
  return ast;
}

describe('vane grammar v2 — variadic positional', () => {
  it('parses arg name str... as variadic; scalar str stays non-variadic', () => {
    const ast = parseVane2('command scan\n  summary s\n  usage u\n  example e\n  arg repos str... "repo list or dirs"\n  handler scan#run\n');
    const d = ast.decls[0] as CommandDecl;
    expect(d.args).toEqual([{ name: 'repos', variadic: true, doc: 'repo list or dirs', pos: { file: 'test.vane', line: 5 } }]);
    expect(validateVane(ast)).toEqual([]);
  });

  it('rejects a variadic that is not last, a second variadic, and variadic+dir', () => {
    const errsOf = (src: string) => validateVane(parseVane(src, 't.vane').ast).map(formatVaneError);
    expect(errsOf('command c\n  summary s\n  usage u\n  example e\n  arg a str...\n  arg b str\n  handler c#run\n')[0])
      .toContain("variadic arg 'a' must be the last positional");
    expect(errsOf('command c\n  summary s\n  usage u\n  example e\n  arg a str...\n  arg b str...\n  handler c#run\n')
      .some((e) => e.includes('must be the last positional') || e.includes('only one variadic'))).toBe(true);
    expect(errsOf('command c\n  summary s\n  usage u\n  example e\n  dir\n  arg a str...\n  handler c#run\n')[0])
      .toContain("cannot coexist with dir");
  });
});
