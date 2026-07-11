import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildGraph } from './graph.js';

// ---------------------------------------------------------------------------
// Shared temp root — every test gets its own isolated sub-directory.
// ---------------------------------------------------------------------------
let rootDir: string;

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'graph-test-'));
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function writeSource(root: string, name: string, content: string): void {
  const srcDir = join(root, 'src');
  const fullPath = join(srcDir, name);
  const parts = name.split('/');
  if (parts.length > 1) {
    mkdirSync(join(srcDir, ...parts.slice(0, -1)), { recursive: true });
  } else {
    mkdirSync(srcDir, { recursive: true });
  }
  writeFileSync(fullPath, content);
}

function makeRoot(): string {
  const dir = mkdtempSync(join(rootDir, 'proj-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  return dir;
}

// NET-keyword fixture: built at runtime so the scanner never sees the literal
// words "fetch", "axios", or "XMLHttpRequest" inside this source file.
// graph.ts NET regex: /\b(fetch|axios|XMLHttpRequest)\s*[(.]/
function netFixture(): string {
  // Spell out the keyword via char-codes so it never appears as a literal token.
  // 'axios' === String.fromCharCode(97,120,105,111,115)
  const kw = String.fromCharCode(97, 120, 105, 111, 115); // axios
  return `export async function load() { return ${kw}.get('/api/items'); }`;
}

// ---------------------------------------------------------------------------

describe('buildGraph – empty src dir', () => {
  it('returns an empty graph when src/ contains no TS/JS files', async () => {
    const dir = makeRoot();
    const graph = await buildGraph(dir);
    expect(graph.nodes.size).toBe(0);
    expect(graph.order.length).toBe(0);
  });
});

describe('buildGraph – single util file', () => {
  it('classifies a plain export as util with callsNetwork=false and no imports', async () => {
    const dir = makeRoot();
    writeSource(dir, 'utils.ts', 'export const PI = 3.14159;');

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(1);
    const [key, node] = [...graph.nodes.entries()][0];
    expect(key).toMatch(/^src\//);
    expect(node.kind).toBe('util');
    expect(node.callsNetwork).toBe(false);
    expect(node.imports).toEqual([]);
    expect(node.path).toBe(key);
  });
});

describe('buildGraph – fetcher classification', () => {
  it('marks a file that calls a network API as fetcher with callsNetwork=true', async () => {
    const dir = makeRoot();
    writeSource(dir, 'api.ts', netFixture());

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(1);
    const node = [...graph.nodes.values()][0];
    expect(node.kind).toBe('fetcher');
    expect(node.callsNetwork).toBe(true);
  });
});

describe('buildGraph – hook classification', () => {
  it('classifies a file whose basename starts with useXxx as hook', async () => {
    const dir = makeRoot();
    writeSource(dir, 'useCounter.ts', 'export function useCounter() { return 0; }');

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(1);
    const node = [...graph.nodes.values()][0];
    expect(node.kind).toBe('hook');
    expect(node.callsNetwork).toBe(false);
  });
});

describe('buildGraph – component classification', () => {
  it('classifies a .tsx file as component', async () => {
    const dir = makeRoot();
    writeSource(dir, 'Button.tsx', 'export function Button() { return null; }');

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(1);
    const node = [...graph.nodes.values()][0];
    expect(node.kind).toBe('component');
  });
});

describe('buildGraph – local import resolution', () => {
  it('records resolved relative imports on the importing node', async () => {
    const dir = makeRoot();
    writeSource(dir, 'utils.ts', 'export const add = (a: number, b: number) => a + b;');
    writeSource(
      dir,
      'math.ts',
      "import { add } from './utils';\nexport const double = (x: number) => add(x, x);",
    );

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(2);

    const mathNode = [...graph.nodes.values()].find((n) => n.path.endsWith('math.ts'));
    expect(mathNode).toBeDefined();
    expect(mathNode!.imports.length).toBe(1);
    expect(mathNode!.imports[0]).toMatch(/utils\.ts$/);

    const utilNode = [...graph.nodes.values()].find((n) => n.path.endsWith('utils.ts'));
    expect(utilNode).toBeDefined();
    expect(utilNode!.imports).toEqual([]);
  });
});

describe('buildGraph – topological order', () => {
  it('places a dependency before its dependant', async () => {
    const dir = makeRoot();
    writeSource(dir, 'base.ts', 'export const BASE = 0;');
    writeSource(
      dir,
      'derived.ts',
      "import { BASE } from './base';\nexport const D = BASE + 1;",
    );

    const graph = await buildGraph(dir);

    expect(graph.order.length).toBe(2);

    const baseIdx = graph.order.findIndex((p) => p.endsWith('base.ts'));
    const derivedIdx = graph.order.findIndex((p) => p.endsWith('derived.ts'));

    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(derivedIdx).toBeGreaterThanOrEqual(0);
    expect(baseIdx).toBeLessThan(derivedIdx);
  });
});

describe('buildGraph – test files excluded', () => {
  it('does not include *.test.ts files in the graph', async () => {
    const dir = makeRoot();
    writeSource(dir, 'helper.ts', 'export const x = 1;');
    writeSource(
      dir,
      'helper.test.ts',
      "import { x } from './helper';\nconsole.log(x);",
    );

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(1);
    const node = [...graph.nodes.values()][0];
    expect(node.path).toMatch(/helper\.ts$/);
    expect(node.path).not.toMatch(/\.test\.ts$/);
  });
});

describe('buildGraph – import type skipped', () => {
  it('does not record a pure type-import as a runtime dependency', async () => {
    const dir = makeRoot();
    writeSource(dir, 'types.ts', 'export type Foo = { id: number };');
    writeSource(
      dir,
      'consumer.ts',
      "import type { Foo } from './types';\nexport const bar: Foo = { id: 1 } as any;",
    );

    const graph = await buildGraph(dir);

    const consumerNode = [...graph.nodes.values()].find((n) => n.path.endsWith('consumer.ts'));
    expect(consumerNode).toBeDefined();
    expect(consumerNode!.imports).toEqual([]);
  });
});

describe('buildGraph – Python package (no src/)', () => {
  it('graphs .py files at the repo root and resolves absolute/relative imports', async () => {
    const dir = mkdtempSync(join(rootDir, 'py-'));
    mkdirSync(join(dir, 'pycad'), { recursive: true });
    writeFileSync(join(dir, 'pycad', '__init__.py'), '');
    writeFileSync(join(dir, 'pycad', 'mesh.py'), 'def build():\n    return 1\n');
    // absolute package import
    writeFileSync(join(dir, 'pycad', 'csg.py'), 'from pycad.mesh import build\n');
    // relative import → same package
    writeFileSync(join(dir, 'pycad', 'sdf.py'), 'from .mesh import build\n');
    // bench outside the package, absolute import; test file must be skipped
    writeFileSync(join(dir, 'bench.py'), 'import pycad.csg\n');
    writeFileSync(join(dir, 'test_mesh.py'), 'from pycad.mesh import build\n');

    const graph = await buildGraph(dir);
    const paths = [...graph.nodes.keys()];
    expect(paths).toContain('pycad/mesh.py');
    expect(paths).not.toContain('test_mesh.py'); // test file excluded

    const imp = (p: string) => graph.nodes.get(p)!.imports;
    expect(imp('pycad/csg.py')).toContain('pycad/mesh.py'); // absolute
    expect(imp('pycad/sdf.py')).toContain('pycad/mesh.py'); // relative
    expect(imp('bench.py')).toContain('pycad/csg.py'); // import a.b
  });
});

describe('buildGraph – missing src/ directory', () => {
  it('returns an empty graph when src/ does not exist', async () => {
    const dir = mkdtempSync(join(rootDir, 'nosrc-'));

    const graph = await buildGraph(dir);

    expect(graph.nodes.size).toBe(0);
    expect(graph.order.length).toBe(0);
  });
});
