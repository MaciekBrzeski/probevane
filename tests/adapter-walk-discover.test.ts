import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles } from '../src/adapters/walk.js';
import { discoverReact } from '../src/adapters/react-vitest-playwright/discover.js';

describe('walkFiles', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'pv-walk-'));
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), '');
    writeFileSync(join(root, 'src', 'b.ts'), '');
    writeFileSync(join(root, 'src', 'nested', 'c.ts'), '');
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.js'), '');
    writeFileSync(join(root, 'dist', 'y.js'), '');
    writeFileSync(join(root, 'coverage', 'z.js'), '');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('lists every file recursively', () => {
    return walkFiles(root).then((files) => {
      const rels = files.map((f) => f.slice(root.length + 1)).sort();
      expect(rels).toContain('a.ts');
      expect(rels).toContain('src/b.ts');
      expect(rels).toContain('src/nested/c.ts');
    });
  });

  it('skips node_modules, dist, and coverage', async () => {
    const files = await walkFiles(root);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes(`${join(root, 'dist')}/`) || f.endsWith('/dist/y.js'))).toBe(false);
    expect(files.some((f) => f.includes('coverage'))).toBe(false);
  });

  it('returns [] for a nonexistent dir (readdir rejection is caught)', async () => {
    expect(await walkFiles(join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('discoverReact', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pv-discover-'));
    const src = join(dir, 'src');
    mkdirSync(src, { recursive: true });
    // a pure slice (cheapest), a component (dearer), plus files that must be skipped
    writeFileSync(join(src, 'counter.slice.ts'), 'export const inc = (n: number) => n + 1;');
    writeFileSync(join(src, 'Widget.tsx'), 'export default function Widget() { return null; }');
    writeFileSync(join(src, 'main.tsx'), 'render();');              // entry → skip
    writeFileSync(join(src, 'Widget.test.tsx'), 'test();');         // test → skip
    writeFileSync(join(src, 'types.d.ts'), 'export type T = number;'); // decl → skip
    writeFileSync(join(src, 'README.md'), '# no');                  // non-source → skip
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('excludes entry, test, decl, and non-source files', async () => {
    const targets = await discoverReact(dir, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('counter.slice');
    expect(names).toContain('Widget');
    expect(names).not.toContain('main');
    expect(names).not.toContain('Widget.test');
    expect(names).not.toContain('types');
    expect(names).not.toContain('README');
  });

  it('ranks the pure slice ahead of the component (easiest first)', async () => {
    const targets = await discoverReact(dir, 'unit');
    const slice = targets.findIndex((t) => t.name === 'counter.slice');
    const comp = targets.findIndex((t) => t.name === 'Widget');
    expect(slice).toBeLessThan(comp);
  });

  it('sourcePath is repo-relative; component is flagged in meta', async () => {
    const targets = await discoverReact(dir, 'unit');
    const widget = targets.find((t) => t.name === 'Widget')!;
    expect(widget.sourcePath).toBe('src/Widget.tsx');
    expect(widget.meta?.isComponent).toBe(true);
  });

  it('e2e kind keeps only components', async () => {
    const targets = await discoverReact(dir, 'e2e');
    expect(targets.map((t) => t.name)).toEqual(['Widget']);
  });
});
