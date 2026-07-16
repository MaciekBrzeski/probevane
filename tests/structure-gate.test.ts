import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { structureGate } from '../src/loop/runes/structure_gate.js';
import { RunCtx } from '../src/loop/ctx.js';

// A tiny repo whose src/ is two feature pyramids on a glue base + a shared leaf.
// The gate reads roles from probevane.config; declaring them keeps the heuristic
// out of the way so the test asserts the RULES, not the classifier.
async function mkRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pv-sg-'));
  await mkdir(join(dir, 'src', 'cli'), { recursive: true });
  await mkdir(join(dir, 'src', 'alpha'), { recursive: true });
  await mkdir(join(dir, 'src', 'beta'), { recursive: true });
  await mkdir(join(dir, 'src', 'util'), { recursive: true });
  await writeFile(join(dir, 'probevane.config.json'),
    JSON.stringify({ arch: { glue: ['cli'], shared: ['util'] } }));
  await writeFile(join(dir, 'src', 'util', 'x.ts'), 'export const x = 1;\n');
  await writeFile(join(dir, 'src', 'alpha', 'a.ts'), "import { x } from '../util/x.js';\nexport const a = x;\n");
  await writeFile(join(dir, 'src', 'beta', 'b.ts'), "import { x } from '../util/x.js';\nexport const b = x;\n");
  await writeFile(join(dir, 'src', 'cli', 'run.ts'), "import { a } from '../alpha/a.js';\nimport { b } from '../beta/b.js';\nexport const r = a + b;\n");
  return dir;
}

const ctxFor = (dir: string) => new RunCtx(dir, {} as never, 'task');

describe('structureGate', () => {
  it('prepare on a clean pyramid tree notes zero pre-existing violations', async () => {
    const rune = structureGate();
    const note = await rune.prepare!(ctxFor(await mkRepo()));
    expect(note).toContain('fits the pyramid model');
  });

  it('allows finishing when no new violation was introduced', async () => {
    const dir = await mkRepo();
    const rune = structureGate();
    const ctx = ctxFor(dir);
    await rune.prepare!(ctx);
    // edit that stays legal: alpha still only imports shared util
    await writeFile(join(dir, 'src', 'alpha', 'a.ts'), "import { x } from '../util/x.js';\nexport const a = x + 1;\n");
    expect((await rune.shouldStop!(ctx)).kind).toBe('allow');
  });

  it('blocks when the run introduces a feature→feature import, naming the edge', async () => {
    const dir = await mkRepo();
    const rune = structureGate();
    const ctx = ctxFor(dir);
    await rune.prepare!(ctx); // baseline: clean
    // alpha now reaches into beta — a new feature→feature violation
    await writeFile(join(dir, 'src', 'alpha', 'a.ts'), "import { b } from '../beta/b.js';\nexport const a = b;\n");
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.reason).toContain('structure_gate');
      expect(d.inject).toContain('feature→feature');
      expect(d.inject).toContain('alpha → beta');
    }
  });

  it('tolerates a PRE-EXISTING violation (ratchet, not absolute)', async () => {
    const dir = await mkRepo();
    // start already dirty: beta imports alpha
    await writeFile(join(dir, 'src', 'beta', 'b.ts'), "import { a } from '../alpha/a.js';\nexport const b = a;\n");
    const rune = structureGate();
    const ctx = ctxFor(dir);
    await rune.prepare!(ctx); // baseline captures beta→alpha
    // touch beta without adding a NEW cross-feature edge
    await writeFile(join(dir, 'src', 'beta', 'b.ts'), "import { a } from '../alpha/a.js';\nexport const b = a + 1;\n");
    expect((await rune.shouldStop!(ctx)).kind).toBe('allow');
  });

  it('exposes a system-prompt addition describing the rule', () => {
    expect(structureGate().systemPromptAddition!()).toContain('pyramid-model gate');
  });
});
