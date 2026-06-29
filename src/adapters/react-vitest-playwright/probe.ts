import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProbeResult, TestTarget } from '../adapter.js';
import { astExtract } from '../ast-probe.js';

// Unit probe — gather GROUND TRUTH from the target source so the model never
// guesses what to import or what props exist. Prefers a real TS AST (ts-morph)
// for accurate exports/params/types; falls back to regex if parsing fails.
export async function probeReactUnit(dir: string, target: TestTarget): Promise<ProbeResult> {
  let src: string;
  try {
    src = await readFile(join(dir, target.sourcePath), 'utf8');
  } catch (e) {
    return { target, facts: {}, digest: '', ok: false, error: `cannot read ${target.sourcePath}: ${e}` };
  }

  const ast = astExtract(src, target.sourcePath);
  const exports = ast ? ast.exports : extractExports(src);
  const components = exports.filter((e) => e.isComponent).map((e) => e.name);
  const functions = exports.filter((e) => !e.isComponent);
  const props = ast ? ast.props : extractProps(src);
  const importPath = './' + target.name; // local module specifier

  const lines: string[] = [];
  lines.push(`GROUND TRUTH for ${target.sourcePath} (import from "${importPath}"):`);
  if (components.length) lines.push(`- React components: ${components.join(', ')}`);
  if (functions.length)
    lines.push(`- Exported functions: ${functions.map((f) => f.signature ?? f.name).join('; ')}`);
  if (props.length) lines.push(`- Props/interfaces: ${props.join('; ')}`);
  const ariaLabels = [...src.matchAll(/aria-label=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => m[1] ?? m[2]);
  if (ariaLabels.length) lines.push(`- aria-labels present: ${unique(ariaLabels).join(', ')}`);
  const roles = [...src.matchAll(/role="([^"]+)"/g)].map((m) => m[1]);
  if (roles.length) lines.push(`- roles present: ${unique(roles).join(', ')}`);

  const ok = exports.length > 0;
  return {
    target,
    facts: { exports, components, functions: functions.map((f) => f.name), props, ariaLabels: unique(ariaLabels) },
    digest: lines.join('\n'),
    ok,
    error: ok ? undefined : 'no exported symbols found to test',
  };
}

// E2E probe — build an app-wide UI inventory (the user-facing ground truth) by
// reading the JSX under src/: aria-labels, roles, button text, placeholders,
// headings, and routes. This is the "probe-before-spec" step for e2e: the model
// targets only selectors that actually exist, killing the assumed-entry
// anti-pattern. (A live Playwright snapshot is a future enhancement; static
// extraction is deterministic and accurate for these SPAs.)
const BASE_URL = process.env.PROBEVANE_BASE_URL ?? 'http://localhost:5173';

export async function probeReactE2e(dir: string, target: TestTarget): Promise<ProbeResult> {
  const files = await collectSources(join(dir, 'src'));
  let all = '';
  for (const f of files) all += (await readFile(f, 'utf8').catch(() => '')) + '\n';

  const ariaLabels = unique([...all.matchAll(/aria-label=(?:"([^"]+)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2]));
  const roles = unique([...all.matchAll(/role="([^"]+)"/g)].map((m) => m[1]));
  const buttonText = unique([...all.matchAll(/<button[^>]*>([^<{][^<]*)<\/button>/g)].map((m) => m[1].trim()));
  const placeholders = unique([...all.matchAll(/placeholder=(?:"([^"]+)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2]));
  const headings = unique([...all.matchAll(/<h[1-6][^>]*>([^<{][^<]*)<\/h[1-6]>/g)].map((m) => m[1].trim()));
  const routes = unique([...all.matchAll(/<Route[^>]*\bpath=(?:"([^"]+)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2]));

  const lines: string[] = [`GROUND TRUTH — UI inventory of the running app at ${BASE_URL} :`];
  if (routes.length) lines.push(`- routes: ${routes.join(', ')}`);
  else lines.push('- routes: single page at "/" (no router detected)');
  if (headings.length) lines.push(`- headings: ${headings.join(', ')}`);
  if (buttonText.length) lines.push(`- button text: ${buttonText.join(', ')}`);
  if (ariaLabels.length) lines.push(`- aria-labels (use getByLabel / getByRole name): ${ariaLabels.join(', ')}`);
  if (roles.length) lines.push(`- explicit roles: ${roles.join(', ')}`);
  if (placeholders.length) lines.push(`- placeholders: ${placeholders.join(', ')}`);

  const ok = ariaLabels.length + buttonText.length + headings.length > 0;
  return {
    target,
    facts: { baseUrl: BASE_URL, ariaLabels, roles, buttonText, placeholders, headings, routes },
    digest: lines.join('\n'),
    ok,
    error: ok ? undefined : 'no user-facing selectors found in src/',
  };
}

async function collectSources(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(e.name)) continue;
      out.push(...(await collectSources(join(root, e.name))));
    } else if (/\.[tj]sx$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
      out.push(join(root, e.name));
    }
  }
  return out;
}

interface ExportInfo {
  name: string;
  isComponent: boolean;
  signature?: string;
}

type AddExport = (name: string, signature?: string) => void;

// export [default] [async] function NAME(args)
function collectFunctionExports(src: string, add: AddExport): void {
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g)) {
    add(m[1], `${m[1]}(${m[2].trim()})`);
  }
}

// export const NAME = (args) =>  /  export const NAME = function
// and export const NAME = <non-arrow value> (thunks, constants, configured fns)
function collectConstExports(src: string, add: AddExport): void {
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:\(([^)]*)\)|[A-Za-z0-9_]+)\s*=>/g)) {
    add(m[1], `${m[1]}(${(m[2] ?? '').trim()})`);
  }
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*[:=]/g)) add(m[1]);
}

// export const { a, b } = X.actions  (redux slice action creators, destructured re-exports)
// export { a, b }  (re-export)
function collectBraceExports(src: string, add: AddExport): void {
  for (const m of src.matchAll(/export\s+const\s*\{([^}]+)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s*:\s*/)[0].trim();
      if (name) add(name);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]+)\}\s*(?:from|;|$)/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) add(name);
    }
  }
}

// export default <expr>  (e.g. `export default slice.reducer`)
function collectDefaultExport(src: string, add: AddExport): void {
  if (/export\s+default\s/.test(src)) {
    const d = src.match(/export\s+default\s+([A-Za-z0-9_.]+)/);
    add('default', d ? `default (= ${d[1]})` : 'default');
  }
}

function extractExports(src: string): ExportInfo[] {
  const out: ExportInfo[] = [];
  const seen = new Set<string>();
  const add: AddExport = (name, signature) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const isComponent = /^[A-Z]/.test(name);
    out.push({ name, isComponent, signature });
  };
  collectFunctionExports(src, add);
  collectConstExports(src, add);
  collectBraceExports(src, add);
  collectDefaultExport(src, add);
  return out;
}

function extractProps(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:export\s+)?interface\s+([A-Za-z0-9_]+Props?)\s*\{([^}]*)\}/g)) {
    const fields = m[2]
      .split('\n')
      .map((l) => l.trim().replace(/;$/, ''))
      .filter(Boolean)
      .join(', ');
    out.push(`${m[1]} { ${fields} }`);
  }
  return out;
}

function unique<T>(a: T[]): T[] {
  return [...new Set(a)];
}
