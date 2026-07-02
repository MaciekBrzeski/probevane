import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { selectAdapter, selectAdapterOrThrow, ADAPTERS } from '../src/adapters/registry.js';
import { readPackageDeps } from '../src/adapters/pkg-deps.js';
import { walkFiles } from '../src/adapters/walk.js';
import { readCoverageSummary } from '../src/adapters/coverage-summary.js';
import { findSpecFiles } from '../src/util/specfiles.js';
import { detectReact } from '../src/adapters/react-vitest-playwright/detect.js';
import { probeReactUnit, probeReactE2e } from '../src/adapters/react-vitest-playwright/probe.js';
import { discoverReact } from '../src/adapters/react-vitest-playwright/discover.js';
import { probeVueUnit, discoverVue } from '../src/adapters/vue-vitest-playwright/probe.js';
import { svelteAdapter } from '../src/adapters/svelte-vitest/index.js';
import type { TestTarget } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping -------------------------------------------------
const dirs: string[] = [];
function tmp(prefix = 'pv-cov-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function write(dir: string, rel: string, contents: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

const unitTarget = (sourcePath: string, name: string): TestTarget => ({ kind: 'unit', sourcePath, name });

// =========================================================================
// pkg-deps.ts — readPackageDeps
// =========================================================================
describe('readPackageDeps', () => {
  it('merges dependencies + devDependencies', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18' }, devDependencies: { vitest: '2' } }));
    const deps = await readPackageDeps(d);
    expect(deps.react).toBe('18');
    expect(deps.vitest).toBe('2');
  });

  it('returns {} when package.json is missing', async () => {
    expect(await readPackageDeps(tmp())).toEqual({});
  });

  it('returns {} when package.json is unparseable', async () => {
    const d = tmp();
    write(d, 'package.json', 'not { valid json');
    expect(await readPackageDeps(d)).toEqual({});
  });
});

// =========================================================================
// walk.ts — walkFiles
// =========================================================================
describe('walkFiles', () => {
  it('lists files recursively, skipping node_modules/dist/coverage', async () => {
    const d = tmp();
    write(d, 'a.ts', 'a');
    write(d, 'sub/b.ts', 'b');
    write(d, 'node_modules/dep/x.js', 'x');
    write(d, 'dist/out.js', 'o');
    write(d, 'coverage/c.json', '{}');
    const files = await walkFiles(d);
    const names = files.map((f) => f.replace(d, ''));
    expect(names).toContain('/a.ts');
    expect(names).toContain('/sub/b.ts');
    expect(names.some((n) => n.includes('node_modules'))).toBe(false);
    expect(names.some((n) => n.includes('dist'))).toBe(false);
    expect(names.some((n) => n.includes('coverage'))).toBe(false);
  });

  it('returns [] for a missing dir (readdir catch)', async () => {
    expect(await walkFiles(join(tmp(), 'nope'))).toEqual([]);
  });
});

// =========================================================================
// coverage-summary.ts — readCoverageSummary
// =========================================================================
describe('readCoverageSummary', () => {
  it('extracts pct from coverage/coverage-summary.json', async () => {
    const d = tmp();
    write(
      d,
      'coverage/coverage-summary.json',
      JSON.stringify({
        total: {
          statements: { pct: 85 },
          branches: { pct: 70 },
          functions: { pct: 90 },
          lines: { pct: 88 },
        },
      }),
    );
    const r = await readCoverageSummary(d);
    expect(r).toEqual({ statements: 85, branches: 70, functions: 90, lines: 88, ok: true });
  });

  it('returns zeros + ok:false when the file is missing (catch)', async () => {
    const r = await readCoverageSummary(tmp());
    expect(r).toEqual({ statements: 0, branches: 0, functions: 0, lines: 0, ok: false });
  });
});

// =========================================================================
// util/specfiles.ts — findSpecFiles
// =========================================================================
describe('findSpecFiles', () => {
  it('finds .test/.spec files recursively, skipping SKIP dirs', async () => {
    const d = tmp();
    write(d, 'foo.test.ts', '');
    write(d, 'bar.spec.tsx', '');
    write(d, 'plain.ts', '');
    write(d, 'nested/baz.test.js', '');
    write(d, 'node_modules/dep/skip.test.ts', '');
    const found = await findSpecFiles(d);
    expect(found).toContain('foo.test.ts');
    expect(found).toContain('bar.spec.tsx');
    expect(found).toContain(join('nested', 'baz.test.js'));
    expect(found).not.toContain('plain.ts');
    expect(found.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('returns [] for a missing dir (readdir catch)', async () => {
    expect(await findSpecFiles(join(tmp(), 'missing'))).toEqual([]);
  });
});

// =========================================================================
// registry.ts — selectAdapter / selectAdapterOrThrow
// =========================================================================
describe('selectAdapter', () => {
  it('picks the react adapter for a react package.json', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18' }, devDependencies: { vite: '5', typescript: '5' } }));
    const a = await selectAdapter(d);
    expect(a?.id).toBe('react-vitest-playwright');
  });

  it('picks the svelte adapter for a svelte package.json', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { svelte: '4', '@sveltejs/vite-plugin-svelte': '3' } }));
    const a = await selectAdapter(d);
    expect(a?.id).toBe('svelte-vitest');
  });

  it('returns null when nothing scores above 0', async () => {
    expect(await selectAdapter(tmp())).toBeNull();
  });

  it('selectAdapterOrThrow returns the adapter on a match', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18' } }));
    const a = await selectAdapterOrThrow(d);
    expect(a.id).toBe('react-vitest-playwright');
  });

  it('selectAdapterOrThrow throws when nothing matches', async () => {
    await expect(selectAdapterOrThrow(tmp())).rejects.toThrow(/no adapter matched/);
  });

  it('ADAPTERS includes the known stacks', () => {
    expect(ADAPTERS.map((a) => a.id)).toContain('react-vitest-playwright');
    expect(ADAPTERS.map((a) => a.id)).toContain('svelte-vitest');
  });
});

// =========================================================================
// react-vitest-playwright/detect.ts — detectReact
// =========================================================================
describe('detectReact', () => {
  it('scores react + build + ts and caps at 1', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18' }, devDependencies: { vite: '5', typescript: '5', '@vitejs/plugin-react': '4' } }));
    expect(await detectReact(d)).toBe(1); // 0.5 + 0.3 + 0.2 capped
  });

  it('scores react alone at 0.5', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18' } }));
    expect(await detectReact(d)).toBeCloseTo(0.5);
  });

  it('counts react-scripts as a recognizable build', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18', 'react-scripts': '5' } }));
    expect(await detectReact(d)).toBeCloseTo(0.8);
  });

  it('counts typescript without react as 0.2', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { typescript: '5' } }));
    expect(await detectReact(d)).toBeCloseTo(0.2);
  });

  it('returns 0 when package.json is missing/unparseable', async () => {
    expect(await detectReact(tmp())).toBe(0);
  });

  it('returns 0 for a package.json with no relevant deps', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { lodash: '4' } }));
    expect(await detectReact(d)).toBe(0);
  });
});

// =========================================================================
// react-vitest-playwright/probe.ts — probeReactUnit
// =========================================================================
describe('probeReactUnit', () => {
  it('extracts components, functions, props, aria-labels and roles', async () => {
    const d = tmp();
    const src = `
export interface ButtonProps { label: string; onClick?: () => void; }
export function Button(props: ButtonProps) {
  return <button aria-label="submit" role="button" onClick={props.onClick}>{props.label}</button>;
}
export const helper = (x: number) => x + 1;
const Tpl = () => <span aria-label={\`go\`} role="status" />;
`;
    write(d, 'src/Button.tsx', src);
    const r = await probeReactUnit(d, unitTarget('src/Button.tsx', 'Button'));
    expect(r.ok).toBe(true);
    expect(r.facts.components).toContain('Button');
    expect(r.facts.functions).toContain('helper');
    expect((r.facts.props as string[]).join(' ')).toMatch(/ButtonProps/);
    expect(r.facts.ariaLabels).toContain('submit'); // "double-quote" form
    expect(r.facts.ariaLabels).toContain('go'); // {`template`} form
    expect(r.digest).toContain('roles present: button'); // roles surfaced in the digest, not facts
    expect(r.digest).toContain('GROUND TRUTH for src/Button.tsx');
    expect(r.digest).toContain('React components: Button');
  });

  it('returns ok:false with an error when the file cannot be read', async () => {
    const d = tmp();
    const r = await probeReactUnit(d, unitTarget('src/Missing.tsx', 'Missing'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot read/);
  });

  it('returns ok:false when there are no exported symbols', async () => {
    const d = tmp();
    write(d, 'src/Empty.tsx', 'const x = 1;\nfunction local() { return x; }\n');
    const r = await probeReactUnit(d, unitTarget('src/Empty.tsx', 'Empty'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no exported symbols/);
  });
});

// =========================================================================
// react-vitest-playwright/probe.ts — probeReactE2e
// =========================================================================
describe('probeReactE2e', () => {
  it('builds a UI inventory from src/ JSX', async () => {
    const d = tmp();
    write(
      d,
      'src/App.tsx',
      `export default function App() {
  return (
    <div>
      <h1>Dashboard</h1>
      <button aria-label="logout">Log out</button>
      <input placeholder="Search" />
      <Route path="/home" />
      <span role="alert">x</span>
    </div>
  );
}
`,
    );
    // skipped: a test file and a node_modules file must not pollute the inventory
    write(d, 'src/App.test.tsx', '<button>nope</button>');
    write(d, 'src/node_modules/lib/x.tsx', '<button>dep</button>');
    const r = await probeReactE2e(d, { kind: 'e2e', sourcePath: 'src', name: 'app' });
    expect(r.ok).toBe(true);
    expect(r.facts.headings).toContain('Dashboard');
    expect(r.facts.buttonText).toContain('Log out');
    expect(r.facts.ariaLabels).toContain('logout');
    expect(r.facts.placeholders).toContain('Search');
    expect(r.facts.roles).toContain('alert');
    expect(r.facts.routes).toContain('/home');
    expect(r.facts.buttonText).not.toContain('nope');
    expect(r.facts.buttonText).not.toContain('dep');
    expect(r.digest).toContain('UI inventory');
    expect(r.digest).toContain('routes: /home');
  });

  it('returns ok:false when src/ has no user-facing selectors', async () => {
    const d = tmp();
    write(d, 'src/util.ts', 'export const x = 1;'); // .ts, not .tsx → not collected
    const r = await probeReactE2e(d, { kind: 'e2e', sourcePath: 'src', name: 'app' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no user-facing selectors/);
    expect(r.digest).toContain('single page at "/"'); // no router branch
  });
});

// =========================================================================
// react-vitest-playwright/discover.ts — discoverReact
// =========================================================================
describe('discoverReact', () => {
  function buildApp(d: string) {
    write(d, 'src/main.tsx', 'export default function Main() { return null; }'); // skipped (entry)
    write(d, 'src/index.ts', 'export const z = 1;'); // skipped (entry)
    write(d, 'src/App.test.tsx', '<div/>'); // skipped (test)
    write(d, 'src/styles.css', 'body{}'); // skipped (non-source)
    write(d, 'src/types/model.ts', 'export const TAG = "x";'); // types/ + pure-ish => lowest cost
    write(d, 'src/helper.ts', 'export const helper = (x) => x + 1;'); // pure-ish
    write(d, 'src/Button.tsx', 'export function Button() { return <button>hi</button>; }'); // component
    write(d, 'src/Store.tsx', 'export function Store() { useSelector(); return null; }'); // redux + component
    write(d, 'src/Nav.tsx', 'export function Nav() { useNavigate(); return <Link/>; }'); // router + component
    write(d, 'src/Ctx.tsx', 'export function Ctx() { useContext(X); return null; }'); // context + component
  }

  it('ranks testable targets easiest-first and skips entry/test/non-source', async () => {
    const d = tmp();
    buildApp(d);
    const targets = await discoverReact(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('model');
    expect(names).toContain('helper');
    expect(names).toContain('Button');
    expect(names).not.toContain('main');
    expect(names).not.toContain('index');
    expect(names).not.toContain('App'); // test file
    expect(names).not.toContain('styles');
    // lowest-cost target first
    expect(targets[0].name).toBe('model');
    // costs ordered non-decreasing
    const costs = targets.map((t) => (t.meta as any).cost as number);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    // redux/router/context cost more than the pure helper
    const cost = (n: string) => (targets.find((t) => t.name === n)!.meta as any).cost as number;
    expect(cost('Store')).toBeGreaterThan(cost('helper'));
    expect(cost('Nav')).toBeGreaterThan(cost('helper'));
    expect(cost('Ctx')).toBeGreaterThan(cost('helper'));
  });

  it('e2e kind keeps only components', async () => {
    const d = tmp();
    buildApp(d);
    const targets = await discoverReact(d, 'e2e');
    const names = targets.map((t) => t.name);
    expect(names).toContain('Button');
    expect(names).not.toContain('helper'); // pure .ts module → not a component
    expect(names).not.toContain('model');
    expect(targets.every((t) => (t.meta as any).isComponent)).toBe(true);
  });

  it('returns [] when src/ is missing (walk catch)', async () => {
    expect(await discoverReact(tmp(), 'unit')).toEqual([]);
  });
});

// =========================================================================
// vue-vitest-playwright/probe.ts — probeVueUnit
// =========================================================================
describe('probeVueUnit', () => {
  it('extracts props (generic form), emits, aria-labels and headings from a .vue SFC', async () => {
    const d = tmp();
    write(
      d,
      'src/Counter.vue',
      `<script setup lang="ts">
defineProps<{ label: string; count: number }>();
const emit = defineEmits<{ change: [v: number] }>();
</script>
<template>
  <h1>Title</h1>
  <button aria-label="inc">+</button>
  <button aria-label="inc">dup</button>
</template>
`,
    );
    const r = await probeVueUnit(d, unitTarget('src/Counter.vue', 'Counter'));
    expect(r.ok).toBe(true);
    expect(r.facts.isVue).toBe(true);
    expect(r.digest).toContain('props: { label: string; count: number }');
    expect(r.digest).toContain('emits: change: [v: number]');
    expect(r.digest).toMatch(/aria-labels.*inc/);
    expect(r.digest).toContain('headings: Title');
    expect(r.digest).toContain('mount with @vue/test-utils');
  });

  it('extracts props from the options defineProps({...}) form', async () => {
    const d = tmp();
    write(d, 'src/Opt.vue', `<script setup>\ndefineProps({ name: String })\n</script>\n<template><div/></template>\n`);
    const r = await probeVueUnit(d, unitTarget('src/Opt.vue', 'Opt'));
    expect(r.ok).toBe(true);
    expect(r.digest).toContain('props: { name: String }');
  });

  it('extracts exported functions from a plain .ts module', async () => {
    const d = tmp();
    write(d, 'src/calc.ts', 'export function add(a: number, b: number) { return a + b; }\n');
    const r = await probeVueUnit(d, unitTarget('src/calc.ts', 'calc'));
    expect(r.ok).toBe(true);
    expect(r.facts.isVue).toBe(false);
    expect(r.digest).toMatch(/exported functions: add\(a: number, b: number\)/);
  });

  it('returns ok:false with an error when the file cannot be read', async () => {
    const r = await probeVueUnit(tmp(), unitTarget('src/Nope.vue', 'Nope'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot read/);
  });

  it('returns ok:false for a .ts module with nothing exported', async () => {
    const d = tmp();
    write(d, 'src/empty.ts', 'const x = 1;\n');
    const r = await probeVueUnit(d, unitTarget('src/empty.ts', 'empty'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing testable/);
  });
});

// =========================================================================
// vue-vitest-playwright/probe.ts — discoverVue
// =========================================================================
describe('discoverVue', () => {
  it('discovers .vue and .ts targets, skipping main/test/decl/vite-env', async () => {
    const d = tmp();
    write(d, 'src/Counter.vue', '<template><div/></template>');
    write(d, 'src/util.ts', 'export const a = 1;');
    write(d, 'src/main.ts', 'createApp();'); // skipped
    write(d, 'src/foo.test.ts', ''); // skipped
    write(d, 'src/types.d.ts', ''); // skipped (.d.ts)
    write(d, 'src/vite-env.d.ts', ''); // skipped
    write(d, 'src/node_modules/lib/x.ts', ''); // skipped dir
    const targets = await discoverVue(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('Counter');
    expect(names).toContain('util');
    expect(names).not.toContain('main');
    expect(names).not.toContain('foo.test');
    expect(names.some((n) => n.includes('vite-env'))).toBe(false);
    expect(targets.every((t) => t.kind === 'unit')).toBe(true);
  });

  it('returns [] when src/ is missing', async () => {
    expect(await discoverVue(tmp(), 'unit')).toEqual([]);
  });
});

// =========================================================================
// svelte-vitest/index.ts — detect / discover / probe
// =========================================================================
describe('svelteAdapter.detect', () => {
  it('scores svelte + plugin and caps at 1', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { svelte: '4', '@sveltejs/vite-plugin-svelte': '3' } }));
    expect(await svelteAdapter.detect(d)).toBeCloseTo(0.9);
  });

  it('scores svelte alone at 0.6', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { svelte: '4' } }));
    expect(await svelteAdapter.detect(d)).toBeCloseTo(0.6);
  });

  it('counts @sveltejs/kit toward the build score', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { svelte: '4', '@sveltejs/kit': '2' } }));
    expect(await svelteAdapter.detect(d)).toBeCloseTo(0.9);
  });

  it('returns 0 with no svelte deps / no package.json', async () => {
    expect(await svelteAdapter.detect(tmp())).toBe(0);
  });
});

describe('svelteAdapter.discover', () => {
  it('lists .svelte and .ts sources, skipping main/test/decl', async () => {
    const d = tmp();
    write(d, 'src/Button.svelte', '<button/>');
    write(d, 'src/store.ts', 'export const x = 1;');
    write(d, 'src/components/Card.svelte', '<div/>'); // nested non-skipped dir → recursion
    write(d, 'src/main.ts', 'new App();'); // skipped
    write(d, 'src/x.test.ts', ''); // skipped
    write(d, 'src/types.d.ts', ''); // skipped
    write(d, 'src/dist/built.ts', ''); // skipped dir
    const targets = await svelteAdapter.discover(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('Button');
    expect(names).toContain('store');
    expect(names).toContain('Card'); // found via nested-dir recursion
    expect(names).not.toContain('main');
    expect(targets.every((t) => t.kind === 'unit')).toBe(true);
  });

  it('returns [] when src/ is missing (walk catch)', async () => {
    expect(await svelteAdapter.discover(tmp(), 'unit')).toEqual([]);
  });
});

describe('svelteAdapter.probe', () => {
  it('extracts props (export let) and aria-labels from a .svelte component', async () => {
    const d = tmp();
    write(
      d,
      'src/Greeting.svelte',
      `<script lang="ts">
  export let name: string;
  export let count = 0;
</script>
<button aria-label="greet">Hi {name}</button>
`,
    );
    const r = await svelteAdapter.probe(d, unitTarget('src/Greeting.svelte', 'Greeting'));
    expect(r.ok).toBe(true);
    expect(r.facts.isSvelte).toBe(true);
    expect(r.digest).toMatch(/props \(export let\): name: string, count/);
    expect(r.digest).toContain('aria-labels: greet');
    expect(r.digest).toContain('@testing-library/svelte');
  });

  it('extracts exported functions from a plain .ts module', async () => {
    const d = tmp();
    write(d, 'src/math.ts', 'export function mul(a: number, b: number) { return a * b; }\n');
    const r = await svelteAdapter.probe(d, unitTarget('src/math.ts', 'math'));
    expect(r.ok).toBe(true);
    expect(r.facts.isSvelte).toBe(false);
    expect(r.digest).toMatch(/exported functions: mul\(a: number, b: number\)/);
  });

  it('returns ok:false for a .ts module with nothing exported (missing file → empty)', async () => {
    const r = await svelteAdapter.probe(tmp(), unitTarget('src/gone.ts', 'gone'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing testable/);
  });

  it('still yields a (label-less) digest for a .svelte with no props (render line keeps it ok)', async () => {
    const d = tmp();
    write(d, 'src/Plain.svelte', '<div>static</div>');
    const r = await svelteAdapter.probe(d, unitTarget('src/Plain.svelte', 'Plain'));
    expect(r.facts.isSvelte).toBe(true);
    expect(r.ok).toBe(true); // the render-instructions line is always pushed for .svelte
  });
});

// =========================================================================
// Regex-fallback paths — only reachable when astExtract() returns null
// (ts-morph's parser is error-tolerant and never throws on real input, so
// these branches are dead through normal calls). We force the fallback by
// mocking ast-probe to null and exercise the regex export/prop extractors.
// =========================================================================
describe('probe regex fallback (AST parse failure)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/adapters/ast-probe.js');
  });

  it('react probe extracts function/const/brace/default exports + Props via regex', async () => {
    vi.resetModules();
    vi.doMock('../src/adapters/ast-probe.js', () => ({ astExtract: () => null }));
    const { probeReactUnit: probe } = await import('../src/adapters/react-vitest-playwright/probe.js');
    const d = tmp();
    const src = `
export function Foo(a, b) { return a; }
export const bar = (x) => x;
export const COUNT = 42;
export const { actionA, actionB } = slice.actions;
export { reExp, other as alias } from './x';
export default slice.reducer;
export interface WidgetProps { name: string; size: number; }
`;
    write(d, 'src/Mod.tsx', src);
    const r = await probe(d, unitTarget('src/Mod.tsx', 'Mod'));
    expect(r.ok).toBe(true);
    const names = (r.facts.exports as { name: string }[]).map((e) => e.name);
    expect(names).toContain('Foo'); // function export
    expect(names).toContain('bar'); // arrow const
    expect(names).toContain('COUNT'); // value const
    expect(names).toContain('actionA'); // destructured brace export
    expect(names).toContain('actionB');
    expect(names).toContain('reExp'); // re-export
    expect(names).toContain('other'); // `other as alias` keeps the source name
    expect(names).toContain('default'); // default export
    expect(r.facts.components).toContain('Foo'); // PascalCase => component
    expect((r.facts.props as string[]).join(' ')).toContain('WidgetProps { name: string; size: number }');
  });

  it('vue probe falls back to regex exports for a plain .ts module', async () => {
    vi.resetModules();
    vi.doMock('../src/adapters/ast-probe.js', () => ({ astExtract: () => null }));
    const { probeVueUnit: probe } = await import('../src/adapters/vue-vitest-playwright/probe.js');
    const d = tmp();
    write(d, 'src/calc.ts', 'export function add(a, b) { return a + b; }\nexport const inc = (n) => n + 1;\n');
    const r = await probe(d, unitTarget('src/calc.ts', 'calc'));
    expect(r.ok).toBe(true);
    expect(r.digest).toMatch(/add\(a, b\)/);
    expect(r.digest).toMatch(/inc\(n\)/);
  });
});

describe('svelteAdapter pure metadata', () => {
  it('exposes id, guidance, audit rules and commands', () => {
    expect(svelteAdapter.id).toBe('svelte-vitest');
    expect(svelteAdapter.guidance('unit')).toMatch(/testing-library\/svelte/);
    expect(Array.isArray(svelteAdapter.auditRules())).toBe(true);
    const cmds = svelteAdapter.commands('.');
    expect(cmds.testUnit).toContain('vitest');
    expect(cmds.coverage).toContain('json-summary');
  });
});
