import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { synthForModule, loadOpenapi, sampleSchema } from '../src/mock/synth.js';
import type { MockBundle } from '../src/mock/synth.js';
import {
  materializeFixtures,
  captureContracts,
  writeContracts,
  readContracts,
} from '../src/mock/contract.js';
import type { Contracts } from '../src/mock/contract.js';
import { toMermaid, toAscii, graphSummary } from '../src/mock/render.js';
import { writeMocks } from '../src/mock/store.js';
import { buildMockPlan, buildChain } from '../src/mock/index.js';
import type { ModuleGraph, ModuleNode, NodeKind } from '../src/mock/graph.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmps: string[] = [];
function tmp(prefix = 'cov-mock-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
// A temp dir UNDER the repo root, so `npx tsx` resolves the repo-local tsx
// without hitting the network (needed by captureContracts / buildChain).
const repoTmps: string[] = [];
function repoTmp(): string {
  const d = mkdtempSync(join(process.cwd(), '.covtmp-'));
  repoTmps.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const d of repoTmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function node(path: string, kind: NodeKind, opts: Partial<ModuleNode> = {}): ModuleNode {
  return { path, kind, imports: opts.imports ?? [], callsNetwork: opts.callsNetwork ?? false };
}
function graphOf(nodes: ModuleNode[], order?: string[]): ModuleGraph {
  const map = new Map<string, ModuleNode>();
  for (const n of nodes) map.set(n.path, n);
  return { nodes: map, order: order ?? nodes.map((n) => n.path) };
}

// ===========================================================================
// synth.ts
// ===========================================================================

describe('sampleSchema', () => {
  it('returns null for falsy schema and past max depth', () => {
    expect(sampleSchema(null, {})).toBe(null);
    expect(sampleSchema(undefined, {})).toBe(null);
    expect(sampleSchema({ type: 'string' }, {}, 7)).toBe(null);
  });

  it('resolves $ref through components (and to null when the ref is missing)', () => {
    const comps = { Product: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } };
    expect(sampleSchema({ $ref: '#/components/schemas/Product' }, comps)).toEqual({ id: 1, name: 'sample' });
    expect(sampleSchema({ $ref: '#/components/schemas/Nope' }, comps)).toBe(null);
  });

  it('prefers an explicit example, then enum[0]', () => {
    expect(sampleSchema({ type: 'string', example: 'hello' }, {})).toBe('hello');
    expect(sampleSchema({ example: 0 }, {})).toBe(0); // example !== undefined even when falsy
    expect(sampleSchema({ enum: ['a', 'b', 'c'] }, {})).toBe('a');
  });

  it('samples scalars by type (with minimum + date-time branches)', () => {
    expect(sampleSchema({ type: 'integer' }, {})).toBe(1);
    expect(sampleSchema({ type: 'integer', minimum: 42 }, {})).toBe(42);
    expect(sampleSchema({ type: 'number' }, {})).toBe(1);
    expect(sampleSchema({ type: 'boolean' }, {})).toBe(true);
    expect(sampleSchema({ type: 'string' }, {})).toBe('sample');
    expect(sampleSchema({ type: 'string', format: 'date-time' }, {})).toBe('2020-01-01T00:00:00Z');
  });

  it('samples an object schema (and an empty object when properties are absent)', () => {
    expect(
      sampleSchema({ type: 'object', properties: { a: { type: 'boolean' }, b: { type: 'string' } } }, {}),
    ).toEqual({ a: true, b: 'sample' });
    expect(sampleSchema({ type: 'object' }, {})).toEqual({});
    // no `type` at all falls through to the object branch (default)
    expect(sampleSchema({ properties: { n: { type: 'number' } } }, {})).toEqual({ n: 1 });
  });

  it('samples arrays as a two-element list, bumping id/name on object items', () => {
    const arr = sampleSchema(
      { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
      {},
    );
    expect(arr).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ]);
  });

  it('arrays of non-id items are left unbumped (bump returns v unchanged)', () => {
    expect(sampleSchema({ type: 'array', items: { type: 'string' } }, {})).toEqual(['sample', 'sample']);
    expect(sampleSchema({ type: 'array', items: { type: 'object', properties: { q: { type: 'integer' } } } }, {})).toEqual([
      { q: 1 },
      { q: 1 },
    ]);
  });
});

describe('loadOpenapi', () => {
  it('loads data/openapi.json when present', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'openapi.json'), JSON.stringify({ openapi: '3.0.0', paths: {} }));
    expect(await loadOpenapi(dir)).toEqual({ openapi: '3.0.0', paths: {} });
  });

  it('falls back to a bare openapi.json at the root', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify({ tag: 'root' }));
    expect(await loadOpenapi(dir)).toEqual({ tag: 'root' });
  });

  it('returns null when no spec exists', async () => {
    expect(await loadOpenapi(tmp())).toBe(null);
  });

  it('returns null when the spec is present but invalid JSON', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'openapi.json'), '{ not: valid json ');
    expect(await loadOpenapi(dir)).toBe(null);
  });
});

describe('synthForModule', () => {
  it('derives handlers, dep mocks, props and a digest from real source', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    // NB: no `method:` option anywhere here — guessMethod scans 200 chars ahead,
    // so a method option would bleed into neighbouring calls. POST is tested
    // separately below in isolation.
    const src = [
      "const BASE = '/api';",
      'export interface ThingProps { id: number; title: string; }',
      'export async function load(user) {',
      '  await fetch(`${BASE}/products`);',
      "  await fetch(`${BASE}/products`);", // duplicate → deduped
      '  await axios.get(`/api/users/${id}`);',
      "  await fetch('https://api.test.com/v1/items?page=1');", // origin + query stripped
      '  await fetch(`/api/${user.id}/detail`);', // non-word template → :param
      "  await fetch('https://only.host');", // becomes '/'
      '  return null;',
      '}',
    ].join('\n');
    writeFileSync(join(dir, 'src', 'mod.ts'), src);

    const n = node('src/mod.ts', 'component', {
      imports: ['src/client.ts', 'src/fetch2.ts', 'src/useThing.ts', 'src/plain.ts', 'src/missing.ts'],
    });
    const graph = graphOf([
      n,
      node('src/client.ts', 'util', { callsNetwork: true }), // callsNetwork → mock
      node('src/fetch2.ts', 'fetcher'), // kind fetcher → mock (even without callsNetwork)
      node('src/useThing.ts', 'hook'), // kind hook → mock
      node('src/plain.ts', 'util'), // pure util → NOT mocked
      // 'src/missing.ts' deliberately absent from the graph → excluded
    ]);

    const b = await synthForModule(dir, n, graph, null);

    expect(b.module).toBe('src/mod.ts');
    const sigs = b.handlers.map((h) => `${h.method} ${h.urlPattern}`);
    expect(sigs).toContain('GET /api/products');
    expect(sigs).toContain('GET /api/users/:id');
    expect(sigs).toContain('GET /v1/items');
    expect(sigs).toContain('GET /api/:param/detail');
    expect(sigs).toContain('GET /');
    // dedup: /api/products appears once
    expect(sigs.filter((s) => s === 'GET /api/products')).toHaveLength(1);

    // samples without openapi: collection → [], :id pattern → { id: 1 }
    expect(b.handlers.find((h) => h.urlPattern === '/api/products')!.sample).toEqual([]);
    expect(b.handlers.find((h) => h.urlPattern === '/api/users/:id')!.sample).toEqual({ id: 1 });

    expect(b.depMocks).toEqual(['src/client.ts', 'src/fetch2.ts', 'src/useThing.ts']);
    expect(b.props).toBe('ThingProps { id: number; title: string; }');

    expect(b.digest).toContain('MOCK BOUNDARY for src/mod.ts (component):');
    expect(b.digest).toContain('GET /api/products');
    expect(b.digest).toContain('dependency modules to vi.mock');
    expect(b.digest).toContain('props fixture from type: ThingProps');
  });

  it('guesses HTTP method from axios.<verb> and from a fetch method option', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'w.ts'),
      "export const a = () => axios.post('/api/orders', body);\n" +
        "export const b = () => fetch('/api/login', { method: 'put' });\n",
    );
    const n = node('src/w.ts', 'fetcher', { callsNetwork: true });
    const b = await synthForModule(dir, n, graphOf([n]), null);
    const sigs = b.handlers.map((h) => `${h.method} ${h.urlPattern}`);
    expect(sigs).toContain('POST /api/orders');
    expect(sigs).toContain('PUT /api/login');
  });

  it('samples responses from a matched OpenAPI spec', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'api.ts'),
      "export const get = (id) => axios.get(`/api/users/${id}`);\nexport const all = () => fetch('/api/products');\n",
    );
    const openapi = {
      components: { schemas: { User: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } } },
      paths: {
        '/api/users/{id}': {
          get: {
            responses: {
              // $ref into components → exercises the components lookup branch
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
            },
          },
        },
        '/api/products': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } } } } },
            },
          },
        },
      },
    };
    const n = node('src/api.ts', 'fetcher', { callsNetwork: true });
    const b = await synthForModule(dir, n, graphOf([n]), openapi);
    expect(b.handlers.find((h) => h.urlPattern === '/api/users/:id')!.sample).toEqual({ id: 1, name: 'sample' });
    expect(b.handlers.find((h) => h.urlPattern === '/api/products')!.sample).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ]);
  });

  it('a missing/unreadable file + no boundary yields a pure-module digest', async () => {
    const dir = tmp();
    const n = node('src/gone.ts', 'util', { imports: [] });
    const b = await synthForModule(dir, n, graphOf([n]), null);
    expect(b.handlers).toEqual([]);
    expect(b.depMocks).toEqual([]);
    expect(b.props).toBeUndefined();
    expect(b.digest).toContain('pure module: no mocks needed.');
  });
});

// ===========================================================================
// render.ts
// ===========================================================================

describe('toMermaid', () => {
  it('renders a flat per-file diagram for small graphs', () => {
    const g = graphOf([
      node('src/Page.tsx', 'component', { imports: ['src/api.ts', 'src/absent.ts'] }),
      node('src/api.ts', 'fetcher', { callsNetwork: true }),
    ]);
    const m = toMermaid(g);
    expect(m).toContain('```mermaid');
    expect(m).toContain('graph TD');
    expect(m).toContain('src_Page_tsx["Page.tsx (component)"]:::component');
    expect(m).toContain('src_api_ts["api.ts (fetcher) 🌐"]:::fetcher');
    expect(m).toContain('src_Page_tsx --> src_api_ts');
    expect(m).not.toContain('src_absent_ts'); // edge to a non-node is skipped
    expect(m).toContain('classDef fetcher');
  });

  it('collapses to a directory-level overview for large graphs', () => {
    const nodes: ModuleNode[] = [];
    for (let i = 0; i < 30; i++) nodes.push(node(`src/a/f${i}.ts`, 'util', i === 0 ? { callsNetwork: true } : {}));
    for (let i = 0; i < 12; i++) nodes.push(node(`src/b/g${i}.ts`, 'util'));
    // one cross-dir edge a -> b, plus an intra-dir edge (skipped) and a dangling import
    nodes[1].imports = ['src/b/g0.ts', 'src/a/f2.ts', 'src/x/none.ts'];
    nodes.push(node('lib/z.ts', 'util')); // topDir not 'src'
    nodes.push(node('solo.ts', 'util')); // single-segment path → topDir is the file itself
    const g = graphOf(nodes);
    const m = toMermaid(g);
    expect(m).toContain('flowchart LR');
    expect(m).toContain('a/ (30) 🌐'); // dir count + net flag
    expect(m).toContain('b/ (12)');
    expect(m).toContain('lib/ (1)');
    expect(m).toContain('solo.ts/ (1)');
    expect(m).toContain('a --> b');
    expect(m).not.toContain('a --> a'); // intra-dir edge skipped
    expect(m).not.toContain('--> x'); // dangling import skipped
  });
});

describe('toAscii', () => {
  it('walks roots to deps with connectors, net markers and dup back-refs', () => {
    const g = graphOf([
      node('src/Root.tsx', 'component', { imports: ['src/A.ts', 'src/B.ts'] }),
      node('src/A.ts', 'fetcher', { callsNetwork: true, imports: ['src/C.ts'] }),
      node('src/B.ts', 'util', { imports: ['src/C.ts'] }),
      node('src/C.ts', 'util'),
    ]);
    const a = toAscii(g);
    expect(a).toContain('🧩 Root.tsx');
    expect(a).toContain('🌐 A.ts 🌐net'); // fetcher icon + net marker
    expect(a).toContain('├─ ');
    expect(a).toContain('└─ ');
    // C appears under A first, then again under B marked as a back-reference
    expect(a).toContain('⚙️ C.ts');
    expect(a).toContain('↺');
  });
});

describe('graphSummary', () => {
  it('counts modules by kind and network reach', () => {
    const g = graphOf([
      node('src/a.ts', 'fetcher', { callsNetwork: true }),
      node('src/b.ts', 'util'),
      node('src/c.ts', 'util'),
    ]);
    const s = graphSummary(g);
    expect(s).toContain('3 modules');
    expect(s).toContain('1 fetcher');
    expect(s).toContain('2 util');
    expect(s).toContain('1 touch the network');
  });

  it('handles an empty graph', () => {
    expect(graphSummary(graphOf([]))).toBe('0 modules (); 0 touch the network');
  });
});

// ===========================================================================
// contract.ts
// ===========================================================================

describe('materializeFixtures', () => {
  it('writes non-empty array samples once, keyed by url tail', async () => {
    const dir = tmp();
    const plan: any = {
      handlers: [
        { method: 'GET', urlPattern: '/api/products', sample: [{ id: 1 }, { id: 2 }] },
        { method: 'GET', urlPattern: '/api/products', sample: [{ id: 9 }] }, // dup name → first wins
        { method: 'GET', urlPattern: '/api/users/:id', sample: { id: 1 } }, // not an array → skipped
        { method: 'GET', urlPattern: '/api/empty', sample: [] }, // empty array → skipped
        { method: 'GET', urlPattern: '/:id', sample: [{ x: 1 }] }, // no named segment → 'data'
      ],
    };
    const fixtures = await materializeFixtures(dir, plan);
    expect(fixtures).toEqual({ products: [{ id: 1 }, { id: 2 }], data: [{ x: 1 }] });
    const written = readFileSync(join(dir, 'test-fixtures', 'products.json'), 'utf8');
    expect(JSON.parse(written)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(written.endsWith('\n')).toBe(true);
    expect(existsSync(join(dir, 'test-fixtures', 'data.json'))).toBe(true);
  });

  it('returns {} and writes nothing when no array samples qualify', async () => {
    const dir = tmp();
    const fixtures = await materializeFixtures(dir, { handlers: [{ method: 'GET', urlPattern: '/x', sample: {} }] } as any);
    expect(fixtures).toEqual({});
    expect(existsSync(join(dir, 'test-fixtures'))).toBe(true); // dir made, but empty
  });
});

describe('writeContracts / readContracts', () => {
  it('round-trips a contracts file', async () => {
    const dir = tmp();
    const c: Contracts = { fixtures: { products: [{ id: 1 }] }, outputs: { 'src/u.ts#sort': [{ id: 1 }] } };
    await writeContracts(dir, c);
    const raw = readFileSync(join(dir, 'test-fixtures', 'contracts.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(await readContracts(dir)).toEqual(c);
  });

  it('readContracts returns null when the file is missing', async () => {
    expect(await readContracts(tmp())).toBe(null);
  });
});

describe('captureContracts', () => {
  it('returns {} when there are no eligible util modules', async () => {
    const dir = tmp();
    const g = graphOf([node('src/api.ts', 'fetcher', { callsNetwork: true })]);
    expect(await captureContracts(dir, g, { products: [{ id: 1 }] })).toEqual({});
  });

  it('returns {} when there are no fixtures', async () => {
    const dir = tmp();
    const g = graphOf([node('src/u.ts', 'util')]);
    expect(await captureContracts(dir, g, {})).toEqual({});
  });

  it('returns {} (catch branch) when the harness output has no parseable contracts', async () => {
    const dir = repoTmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    // Syntactically broken module → tsx errors → no __CONTRACTS__ marker → JSON.parse throws → {}
    writeFileSync(join(dir, 'src', 'broken.ts'), 'export function f(a) { return a.(( ; }\n');
    const g = graphOf([node('src/broken.ts', 'util')]);
    expect(await captureContracts(dir, g, { products: [{ id: 1 }] })).toEqual({});
  }, 60_000);

  it('runs util transformers over fixtures and freezes their outputs', async () => {
    const dir = repoTmp(); // under repo root so `npx tsx` resolves
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'u.ts'),
      'export function sortByName(a){ return [...a].sort((x,y)=>String(x.name).localeCompare(String(y.name))); }\n' +
        'export function addTwo(a,b){ return a+b; }\n', // arity !== 1 → skipped
    );
    const g = graphOf([node('src/u.ts', 'util')]);
    const fixtures = { products: [{ id: 2, name: 'Beta' }, { id: 1, name: 'Alpha' }] };
    const out = await captureContracts(dir, g, fixtures);
    expect(out['src/u.ts#sortByName']).toEqual([
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' },
    ]);
    expect(out['src/u.ts#addTwo']).toBeUndefined();
    // the harness file is cleaned up
    expect(existsSync(join(dir, '.probevane-capture.mjs'))).toBe(false);
  }, 60_000);
});

// ===========================================================================
// store.ts
// ===========================================================================

describe('writeMocks', () => {
  it('writes handlers (importing shared fixtures / inlining the rest), server + setup', async () => {
    const dir = tmp();
    const handlers = [
      { method: 'GET', urlPattern: '/api/products', sample: [{ id: 1, name: 'Item 1' }] }, // matches fixture
      { method: 'GET', urlPattern: '/api/users/:id', sample: { id: 1 } }, // object → inline
      { method: 'POST', urlPattern: '/api/tags', sample: [{ tag: 'x' }] }, // array but no fixture → inline
    ];
    const fixtures = { products: [{ id: 1, name: 'Item 1' }] };
    const handlersPath = await writeMocks(dir, handlers, fixtures);

    expect(handlersPath).toBe(join(dir, 'src', 'mocks', 'handlers.ts'));
    const h = readFileSync(handlersPath, 'utf8');
    expect(h).toContain("import { http, HttpResponse } from 'msw';");
    expect(h).toContain("import products from '../../test-fixtures/products.json';");
    expect(h).toContain("http.get('/api/products', () => HttpResponse.json(products)),");
    expect(h).toContain("http.get('/api/users/:id', () => HttpResponse.json({");
    expect(h).toContain('"id": 1'); // inlined object body
    expect(h).toContain("http.post('/api/tags', () => HttpResponse.json([");

    const server = readFileSync(join(dir, 'src', 'mocks', 'server.ts'), 'utf8');
    expect(server).toContain('export const server = setupServer(...handlers);');

    const setup = readFileSync(join(dir, 'vitest.setup.ts'), 'utf8');
    expect(setup).toContain("import '@testing-library/jest-dom/vitest';");
    expect(setup).toContain('probevane:msw-global');
    expect(setup).toContain("import { server } from './src/mocks/server';");
    expect(setup).toContain("server.listen({ onUnhandledRequest: 'error' })");
  });

  it('defaults fixtures to {} so all array samples inline', async () => {
    const dir = tmp();
    const h = await writeMocks(dir, [{ method: 'GET', urlPattern: '/api/x', sample: [{ a: 1 }] }]);
    const src = readFileSync(h, 'utf8');
    expect(src).not.toContain("from '../../test-fixtures/"); // no fixture import line
    expect(src).toContain("http.get('/api/x', () => HttpResponse.json([");
  });

  it('appends jest-dom (no MSW block) to an existing setup that already has the MSW mark', async () => {
    const dir = tmp();
    const setupPath = join(dir, 'vitest.setup.ts');
    writeFileSync(setupPath, '// probevane:msw-global already wired\nconst keep = 1;\n');
    await writeMocks(dir, [{ method: 'GET', urlPattern: '/api/x', sample: { id: 1 } }]);
    const setup = readFileSync(setupPath, 'utf8');
    expect(setup).toContain("import '@testing-library/jest-dom/vitest';"); // jest-dom still ensured
    expect(setup).toContain('const keep = 1;'); // original preserved
    expect(setup).not.toContain('server.listen'); // early-return: no second MSW block
  });

  it('keeps a single jest-dom import and appends the MSW block when none present', async () => {
    const dir = tmp();
    const setupPath = join(dir, 'vitest.setup.ts');
    writeFileSync(setupPath, "import '@testing-library/jest-dom/vitest';\nconst pre = true;\n");
    await writeMocks(dir, [{ method: 'GET', urlPattern: '/api/x', sample: { id: 1 } }]);
    const setup = readFileSync(setupPath, 'utf8');
    expect(setup.match(/@testing-library\/jest-dom/g)).toHaveLength(1); // not duplicated
    expect(setup).toContain('const pre = true;');
    expect(setup).toContain('server.listen'); // block appended
  });
});

// ===========================================================================
// index.ts
// ===========================================================================

function writeProject(dir: string, withOpenapi: boolean) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'api.ts'),
    "const BASE = '/api';\nexport async function getProducts(){ return fetch(`${BASE}/products`); }\n",
  );
  writeFileSync(
    join(dir, 'src', 'util.ts'),
    'export function sortByName(a){ return [...a].sort((x,y)=>String(x.name).localeCompare(String(y.name))); }\n',
  );
  if (withOpenapi) {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'openapi.json'),
      JSON.stringify({
        paths: {
          '/api/products': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }
}

describe('buildMockPlan', () => {
  it('builds a whole-app plan: graph, per-module bundles, deduped handlers, digest', async () => {
    const dir = tmp();
    writeProject(dir, false);
    const plan = await buildMockPlan(dir);
    expect(plan.graph.nodes.size).toBe(2);
    expect(plan.bundles.map((b: MockBundle) => b.module).sort()).toEqual(['src/api.ts', 'src/util.ts']);
    const sigs = plan.handlers.map((h) => `${h.method} ${h.urlPattern}`);
    expect(sigs).toContain('GET /api/products');
    expect(plan.digest).toContain('MOCK PLAN (2 modules, 1 network endpoints):');
    expect(plan.digest).toContain('MOCK BOUNDARY for src/api.ts');
  });
});

describe('buildChain', () => {
  it('materializes fixtures, captures contracts, writes mocks + contracts, enriches the digest', async () => {
    const dir = repoTmp();
    writeProject(dir, true);
    const plan = await buildChain(dir);

    // fixtures materialized from the OpenAPI-sampled array
    expect(plan.fixtures).toEqual({
      products: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ],
    });
    expect(existsSync(join(dir, 'test-fixtures', 'products.json'))).toBe(true);

    // captured transformer output over the fixture
    expect(plan.outputs!['src/util.ts#sortByName']).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ]);

    // contracts.json written
    const contracts = JSON.parse(readFileSync(join(dir, 'test-fixtures', 'contracts.json'), 'utf8'));
    expect(contracts.fixtures.products).toHaveLength(2);

    // MSW handlers written (handlers.length > 0 branch)
    expect(existsSync(join(dir, 'src', 'mocks', 'handlers.ts'))).toBe(true);

    // digest enriched with both CHAIN sections
    expect(plan.digest).toContain('CHAIN — canonical fixtures');
    expect(plan.digest).toContain('CHAIN — captured transformer outputs');
    expect(plan.digest).toContain('test-fixtures/products.json =');
  }, 60_000);

  it('still produces a plan (no chain sections) when there is nothing to materialize', async () => {
    const dir = repoTmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    // pure util only: no network handlers, no fixtures, no captured outputs
    writeFileSync(join(dir, 'src', 'pure.ts'), 'export const k = 1;\n');
    const plan = await buildChain(dir);
    expect(plan.fixtures).toEqual({});
    expect(plan.outputs).toEqual({});
    expect(plan.digest).not.toContain('CHAIN —');
    expect(plan.digest).toContain('MOCK PLAN');
    expect(existsSync(join(dir, 'src', 'mocks'))).toBe(false); // handlers.length === 0 → no writeMocks
  }, 60_000);
});
