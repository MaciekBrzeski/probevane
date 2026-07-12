#!/usr/bin/env node
// Build the control-center UI: TSX components → one inline bundle → the same
// self-contained src/ui/control.html the daemon serves. control.html is a
// GENERATED artifact (like SKILL.md): sources live in src/ui/app/, and CI runs
// `node scripts/build-ui.mjs --check` as a drift gate.
//
// Convention over imports: a capitalized JSX tag <RunCard/> resolves to
// src/ui/app/components/RunCard.tsx by NAME — never written as an import. The
// auto-import plugin injects the import at compile time; a missing file is a
// hard esbuild error, so every component path is findable at compile time.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'src', 'ui', 'app');
const COMPONENTS = join(APP, 'components');
const OUT = join(ROOT, 'src', 'ui', 'control.html');

// Component files may live in subfolders (components/panels/RunsPanel.tsx) —
// tags still resolve by bare NAME, so names must be unique across the tree.
function walkTsx(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walkTsx(join(dir, e.name)));
    else if (e.name.endsWith('.tsx')) out.push(join(dir, e.name));
  }
  return out;
}

/** name → absolute file path for every component; throws on duplicate names. */
function componentIndex() {
  const index = new Map();
  for (const file of walkTsx(COMPONENTS)) {
    const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.tsx$/, '');
    const prev = index.get(name);
    if (prev) {
      throw new Error(
        `build-ui: duplicate component name "${name}" — ${prev.replace(ROOT + '/', '')} vs ${file.replace(ROOT + '/', '')}; tags resolve by bare name, names must be unique`,
      );
    }
    index.set(name, file);
  }
  return index;
}

// --- auto-import: scan each .tsx module for capitalized JSX tags that are not
// imported and not declared locally, then prepend convention imports. Runs as
// an esbuild onLoad plugin so tsc/esbuild still do all real checking.
// Negative lookbehind: `foo<HTMLElement>` / `)<Cast>` are generics/casts, not
// JSX — a real tag never follows an identifier char or a closing paren.
const TAG_RE = /(?<![\w)])<([A-Z][A-Za-z0-9]*)[\s/>]/g;

function autoImports(source, filePath, components) {
  // A local named h/Fragment silently shadows the JSX factory (esbuild resolves
  // the factory lexically) — the whole component then crashes at runtime. Ban it.
  const shadow = source.match(/\b(?:const|let|var|function)\s+(h|Fragment)\b/);
  if (shadow) {
    throw new Error(
      `build-ui: ${filePath.replace(ROOT + '/', '')} declares a local "${shadow[1]}" — it shadows the JSX factory; rename it`,
    );
  }
  const tags = new Set();
  for (const m of source.matchAll(TAG_RE)) tags.add(m[1]);
  tags.delete('Fragment');
  const missing = [...tags].filter(
    (t) =>
      !new RegExp(`\\bimport\\b[^;]*\\b${t}\\b`).test(source) &&
      !new RegExp(`\\b(function|const|class)\\s+${t}\\b`).test(source),
  );
  const lines = [];
  for (const t of missing) {
    const file = components.get(t);
    if (!file) {
      throw new Error(
        `build-ui: <${t}/> in ${filePath.replace(ROOT + '/', '')} has no ` +
          `${t}.tsx under src/ui/app/components/ — component tags resolve by convention (one component per file, name = filename)`,
      );
    }
    lines.push(`import { ${t} } from '${file}';`);
  }
  // h/Fragment are always in scope — the jsxFactory needs them.
  if (!/from ['"].*runtime(\.js)?['"]/.test(source)) {
    lines.push(`import { h, Fragment } from '${join(ROOT, 'src', 'ui', 'runtime.ts')}';`);
  }
  return lines.length ? lines.join('\n') + '\n' + source : source;
}

function conventionPlugin(components) {
  return {
    name: 'component-convention',
    setup(b) {
      // app root files + any depth under components/
      b.onLoad({ filter: /src\/ui\/app(\/components(\/[^/]+)*)?\/[^/]+\.tsx$/ }, (args) => ({
        contents: autoImports(readFileSync(args.path, 'utf8'), args.path, components),
        loader: 'tsx',
        resolveDir: dirname(args.path),
      }));
    },
  };
}

// Bijection guard: every component file must export exactly its filename.
function checkBijection(components) {
  for (const [name, file] of components) {
    const src = readFileSync(file, 'utf8');
    if (!new RegExp(`export (function|const) ${name}\\b`).test(src)) {
      throw new Error(`build-ui: ${file.replace(ROOT + '/', '')} must export "${name}" (component name = filename)`);
    }
  }
}

// Ambient declarations so `tsc -p tsconfig.ui.json` type-checks the raw
// sources (which never write imports): every component + h/Fragment becomes a
// typed global. Regenerated each build; drift-gated with control.html.
function writeAmbient(components) {
  const decls = [...components.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, file]) => `  const ${n}: typeof import('./${relative(APP, file)}').${n};`)
    .join('\n');
  const body = `// GENERATED by scripts/build-ui.mjs — typed globals for the component
// convention (tags resolve by filename; imports are injected at build time).
declare global {
  const h: typeof import('../runtime.ts').h;
  const Fragment: typeof import('../runtime.ts').Fragment;
${decls}
}
export {};
`;
  const p = join(APP, 'auto-imports.d.ts');
  const current = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (current !== body) writeFileSync(p, body);
}

/**
 * Compile the whole control center from the TSX sources and return the final
 * self-contained HTML (~20ms). The daemon calls it per request under
 * PROBEVANE_UI_DEV — the runtime compiler: edit a component, refresh, see it,
 * no rebuild step, no daemon restart.
 */
export async function buildControlHtml() {
  const components = componentIndex();
  checkBijection(components);
  writeAmbient(components);
  const entry = join(APP, 'main.tsx');
  if (!existsSync(entry)) throw new Error('build-ui: src/ui/app/main.tsx missing');

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    plugins: [conventionPlugin(components)],
    minify: false, // generated file stays reviewable in diffs
  });
  const js = result.outputFiles[0].text;

  const shell = readFileSync(join(APP, 'shell.html'), 'utf8');
  const css = readFileSync(join(APP, 'control.css'), 'utf8');
  const html = shell
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js);
  const banner = '<!-- GENERATED by scripts/build-ui.mjs from src/ui/app/ — do not edit; edit the .tsx sources -->\n';
  return banner + html;
}

async function main() {
  const out = await buildControlHtml();
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== out) {
      console.error('[build-ui] control.html is stale — run `node scripts/build-ui.mjs` and commit');
      process.exit(1);
    }
    console.log('[build-ui] control.html in sync');
    return;
  }
  writeFileSync(OUT, out);
  console.log(`[build-ui] wrote src/ui/control.html (${(out.length / 1024).toFixed(1)}kB)`);
}

// CLI when executed directly; importable module for the daemon's dev compiler.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
