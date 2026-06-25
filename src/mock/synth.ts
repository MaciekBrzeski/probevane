import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModuleNode, ModuleGraph } from './graph.js';

// Mock synthesis — for a module, derive its input boundary and produce concrete
// mocks. Data sources in priority order: OpenAPI schema → TS types → (recorded,
// future) → LLM-fills-gaps (the model writes the spec; we hand it real handlers).

export interface HandlerSpec {
  method: string; // GET/POST/...
  urlPattern: string; // e.g. /api/products  or /api/products/:id
  sample: unknown; // sample response body
}

export interface MockBundle {
  module: string;
  handlers: HandlerSpec[];
  depMocks: string[]; // local modules to vi.mock
  props?: string; // prop-fixture hint (from TS interface)
  digest: string; // human/LLM-readable summary
}

const NET_CALL = /\b(?:fetch|axios(?:\.\w+)?)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;

export async function synthForModule(
  dir: string,
  node: ModuleNode,
  graph: ModuleGraph,
  openapi: any | null,
): Promise<MockBundle> {
  const src = await readFile(join(dir, node.path), 'utf8').catch(() => '');

  // const string vars (e.g. `const BASE = '/api'`) so `${BASE}/products` resolves.
  const consts = new Map<string, string>();
  for (const c of src.matchAll(/const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g)) consts.set(c[1], c[2]);

  // 1) Network calls → handler specs (response sampled from OpenAPI if matched).
  const handlers: HandlerSpec[] = [];
  for (const m of src.matchAll(NET_CALL)) {
    const raw = m[1].replace(/\$\{(\w+)\}/g, (_s, name) => consts.get(name) ?? '${' + name + '}');
    const method = guessMethod(src, m.index ?? 0);
    const urlPattern = normalizeUrl(raw);
    const sample = sampleForPath(urlPattern, method, openapi);
    if (!handlers.some((h) => h.method === method && h.urlPattern === urlPattern))
      handlers.push({ method, urlPattern, sample });
  }

  // 2) Local deps that themselves call network or are hooks → candidates to vi.mock.
  const depMocks = node.imports.filter((dep) => {
    const dn = graph.nodes.get(dep);
    return dn && (dn.callsNetwork || dn.kind === 'hook' || dn.kind === 'fetcher');
  });

  // 3) Props interface (TS) as a fixture hint.
  const propsIface = src.match(/(?:export\s+)?interface\s+(\w*Props)\s*\{([^}]*)\}/);
  const props = propsIface ? `${propsIface[1]} { ${propsIface[2].trim().replace(/\s+/g, ' ')} }` : undefined;

  const digest = renderDigest(node, handlers, depMocks, props);
  return { module: node.path, handlers, depMocks, props, digest };
}

export async function loadOpenapi(dir: string): Promise<any | null> {
  for (const p of ['data/openapi.json', 'data/openapi.filtered.json', 'openapi.json']) {
    const abs = join(dir, p);
    if (await access(abs).then(() => true).catch(() => false)) {
      try {
        return JSON.parse(await readFile(abs, 'utf8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- sampling -------------------------------------------------------------

function sampleForPath(urlPattern: string, method: string, openapi: any | null): unknown {
  if (openapi?.paths) {
    // match openapi path templated form: /api/products/:id  ->  /api/products/{id}
    const oaPath = urlPattern.replace(/:(\w+)/g, '{$1}');
    const op = openapi.paths[oaPath]?.[method.toLowerCase()];
    const schema = op?.responses?.['200']?.content?.['application/json']?.schema;
    if (schema) return sampleSchema(schema, openapi.components?.schemas ?? {});
  }
  // no schema → a neutral placeholder array/object
  return urlPattern.includes(':') ? { id: 1 } : [];
}

export function sampleSchema(schema: any, comps: Record<string, any>, depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return sampleSchema(comps[name], comps, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'array': {
      const item = sampleSchema(schema.items, comps, depth + 1);
      return [bump(item, 0), bump(structuredCloneSafe(item), 1)];
    }
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    case 'string':
      return schema.format === 'date-time' ? '2020-01-01T00:00:00Z' : 'sample';
    case 'object':
    default: {
      const props = schema.properties ?? {};
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) o[k] = sampleSchema(v, comps, depth + 1);
      return o;
    }
  }
}

function bump(v: unknown, i: number): unknown {
  if (v && typeof v === 'object' && 'id' in (v as any)) return { ...(v as any), id: i + 1, name: `Item ${i + 1}` };
  return v;
}

function structuredCloneSafe<T>(v: T): T {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}

// --- helpers --------------------------------------------------------------

const AX_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function guessMethod(src: string, idx: number): string {
  // The match starts at `fetch(` or `axios.<method>(` — read the method off the head.
  const head = src.slice(idx, idx + 30);
  const ax = head.match(/axios\.(\w+)/);
  if (ax && AX_METHODS.has(ax[1].toLowerCase())) return ax[1].toUpperCase();
  const m = src.slice(idx, idx + 200).match(/method:\s*['"](\w+)['"]/i);
  return m ? m[1].toUpperCase() : 'GET';
}

function normalizeUrl(raw: string): string {
  // strip origin, template ${id} → :id (keep the name so it matches OpenAPI {id}), drop query
  let u = raw.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  u = u.replace(/\$\{(\w+)\}/g, ':$1').replace(/\$\{[^}]+\}/g, ':param');
  return u || '/';
}

function renderDigest(node: ModuleNode, handlers: HandlerSpec[], depMocks: string[], props?: string): string {
  const lines = [`MOCK BOUNDARY for ${node.path} (${node.kind}):`];
  if (handlers.length) {
    lines.push('- network (mock via the generated MSW handlers in mocks/handlers.ts; do NOT call the real network):');
    for (const h of handlers) lines.push(`    ${h.method} ${h.urlPattern} → ${JSON.stringify(h.sample).slice(0, 160)}`);
  }
  if (depMocks.length) lines.push(`- dependency modules to vi.mock (return fixtures): ${depMocks.join(', ')}`);
  if (props) lines.push(`- props fixture from type: ${props}`);
  if (!handlers.length && !depMocks.length && !props) lines.push('- pure module: no mocks needed.');
  return lines.join('\n');
}
