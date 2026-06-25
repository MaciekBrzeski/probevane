import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ProbeResult, TestTarget } from '../adapter.js';
import { astExtract } from '../ast-probe.js';

// Vue probe — ground truth from .vue SFCs (defineProps / emits / template
// aria-labels & roles) and plain .ts modules (exports). Regex, no parse.
export async function probeVueUnit(dir: string, target: TestTarget): Promise<ProbeResult> {
  let src: string;
  try {
    src = await readFile(join(dir, target.sourcePath), 'utf8');
  } catch (e) {
    return { target, facts: {}, digest: '', ok: false, error: `cannot read ${target.sourcePath}: ${e}` };
  }

  const isVue = target.sourcePath.endsWith('.vue');
  const lines: string[] = [`GROUND TRUTH for ${target.sourcePath} (import from "./${target.name}${isVue ? '.vue' : ''}"):`];

  if (isVue) {
    const props = src.match(/defineProps<\{([^}]*)\}>/)?.[1] ?? src.match(/defineProps\(\{([^}]*)\}/)?.[1];
    if (props) lines.push(`- props: { ${props.trim().replace(/\s+/g, ' ')} }`);
    const emits = [...src.matchAll(/defineEmits<\{([^}]*)\}>/g)].map((m) => m[1].trim());
    if (emits.length) lines.push(`- emits: ${emits.join('; ')}`);
    const aria = uniq([...src.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]));
    if (aria.length) lines.push(`- aria-labels (use [aria-label="…"] selectors): ${aria.join(', ')}`);
    const headings = uniq([...src.matchAll(/<h[1-6][^>]*>([^<{]+)</g)].map((m) => m[1].trim()));
    if (headings.length) lines.push(`- headings: ${headings.join(', ')}`);
    lines.push('- mount with @vue/test-utils `mount(Component, { props })`; assert via wrapper.get(selector).text() and .trigger("click").');
  } else {
    // Plain .ts module — use the shared AST probe for accurate signatures.
    const ast = astExtract(src, target.sourcePath);
    const all = ast
      ? ast.exports.map((e) => e.signature ?? e.name)
      : [
          ...[...src.matchAll(/export\s+(?:default\s+)?function\s+(\w+)\s*\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2].trim()})`),
          ...[...src.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:\(([^)]*)\)|[\w]+)\s*=>/g)].map((m) => `${m[1]}(${(m[2] ?? '').trim()})`),
        ];
    if (all.length) lines.push(`- exported functions: ${all.join('; ')}`);
  }

  const ok = lines.length > 1;
  return { target, facts: { isVue }, digest: lines.join('\n'), ok, error: ok ? undefined : 'nothing testable found' };
}

export async function discoverVue(dir: string, _kind: string): Promise<TestTarget[]> {
  const root = join(dir, 'src');
  const out: TestTarget[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) {
        if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
        await walk(join(d, e.name));
      } else if (/\.(vue|ts)$/.test(e.name) && !/\.(test|spec|d)\.ts$/.test(e.name) && !/main\.ts$/.test(e.name) && e.name !== 'vite-env.d.ts') {
        const rel = relative(dir, join(d, e.name));
        out.push({ kind: 'unit', sourcePath: rel, name: e.name.replace(/\.(vue|ts)$/, '') });
      }
    }
  };
  await walk(root).catch(() => {});
  return out;
}

function uniq<T>(a: T[]): T[] {
  return [...new Set(a)];
}
