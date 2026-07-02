import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDepDigest } from '../src/loop/dep-digest.js';

// The dependency-API digest: for a --only focus file, surface the export
// signatures of the workspace packages + relative modules it imports, so the
// model needn't read them.

describe('buildDepDigest', () => {
  let ws: string;
  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), 'pv-dep-'));
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*', 'apps/*'] }));
    // a workspace lib package
    mkdirSync(join(ws, 'packages', 'lib', 'src'), { recursive: true });
    writeFileSync(join(ws, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@x/lib', main: 'src/index.ts' }));
    writeFileSync(join(ws, 'packages', 'lib', 'src', 'index.ts'), 'export function adder(a: number, b: number): number { return a + b; }\nexport const TAG = "lib";\n');
    // the focus app + a relative helper
    mkdirSync(join(ws, 'apps', 'web', 'src'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'web', 'src', 'util.ts'), 'export function localHelper(x: string): string { return x; }\n');
    writeFileSync(
      join(ws, 'apps', 'web', 'src', 'focus.ts'),
      'import { adder } from "@x/lib";\nimport { localHelper } from "./util";\nimport { useState } from "react";\nexport const z = adder(1, 2) + localHelper("a").length;\n',
    );
  });
  afterAll(() => rmSync(ws, { recursive: true, force: true }));

  const dir = () => join(ws, 'apps', 'web');

  it('surfaces the workspace package API the focus file imports (with signature)', () => {
    const d = buildDepDigest(dir(), 'src/focus.ts');
    expect(d).toContain('DEPENDENCY APIs');
    expect(d).toContain("@x/lib");
    expect(d).toMatch(/adder\(a: number, b: number\)/);
  });

  it('surfaces a relative module the focus file imports', () => {
    const d = buildDepDigest(dir(), 'src/focus.ts');
    expect(d).toContain("./util");
    expect(d).toContain('localHelper');
  });

  it('ignores external (non-workspace) imports like react', () => {
    expect(buildDepDigest(dir(), 'src/focus.ts')).not.toContain("'react'");
  });

  it('returns empty for a missing focus file', () => {
    expect(buildDepDigest(dir(), 'src/nope.ts')).toBe('');
  });
});
