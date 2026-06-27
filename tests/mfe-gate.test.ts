import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { mfeGate } from '../src/loop/runes/mfe_gate.js';
import { RunCtx } from '../src/loop/ctx.js';

// A federation host whose react is a proper singleton → 0 standards errors.
const CLEAN_CONFIG = `new ModuleFederationPlugin({
  name: 'host',
  remotes: { cart: 'cart@http://x/remoteEntry.js' },
  shared: { react: { singleton: true, requiredVersion: '^18.2.0' } },
});`;

async function mfeRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pv-mfeg-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'webpack.config.js'), CLEAN_CONFIG);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'host', dependencies: { react: '^18.2.0' } }));
  for (const [f, src] of Object.entries(files)) await writeFile(join(dir, f), src);
  return dir;
}

const ctxFor = (dir: string) => new RunCtx(dir, {} as any, 'refactor');

describe('mfeGate (baseline-aware)', () => {
  it('allows when no Module Federation config (not an MFE repo)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-mfeg-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/x.ts'), 'export const x = 1;');
    const gate = mfeGate();
    const ctx = ctxFor(dir);
    await gate.prepare!(ctx);
    expect((await gate.shouldStop!(ctx)).kind).toBe('allow');
  });

  it('blocks when an edit introduces a new MFE standards error', async () => {
    const dir = await mfeRepo({ 'src/App.tsx': "import Cart from 'cart/Cart';\nexport const App = () => Cart;" });
    const gate = mfeGate();
    const ctx = ctxFor(dir);
    await gate.prepare!(ctx); // baseline: 0 errors
    // edit: introduce a deep cross-remote import → boundary error
    await writeFile(join(dir, 'src/App.tsx'), "import x from 'cart/src/internal/util';\nexport const App = () => x;");
    const d = await gate.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.inject).toContain('boundary');
  });

  it('allows a pre-existing error that the run did not worsen', async () => {
    const dir = await mfeRepo({ 'src/App.tsx': "import x from 'cart/src/internal/util';\nexport const App = () => x;" });
    const gate = mfeGate();
    const ctx = ctxFor(dir);
    await gate.prepare!(ctx); // baseline already has the boundary error
    // a benign edit that doesn't add a new error
    await writeFile(join(dir, 'src/App.tsx'), "import x from 'cart/src/internal/util';\nexport const App = () => x; // tidy");
    expect((await gate.shouldStop!(ctx)).kind).toBe('allow');
  });
});
