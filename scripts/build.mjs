// Build to dist/: compile src → dist (tsconfig.build.json) + copy runtime assets
// (src/ui/loop.html, read by `serve`). Imports already use .js extensions, so the
// emitted ESM runs on node directly — no tsx needed at install/runtime.
//
// The one exception is the @facet/* drawing engine: it's a `file:` dep whose
// package `main` points at TypeScript source with extensionless imports (fine for
// tsx/bundlers, unrunnable by plain node). So we esbuild-bundle each facet package
// to standalone JS under dist/node_modules/@facet/* — node resolves THAT (closer
// to dist/cli/*.js than the repo's node_modules) and the compiled dist runs clean.
import { execSync } from 'node:child_process';
import { cpSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

rmSync('dist', { recursive: true, force: true });
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
if (existsSync('src/ui')) cpSync('src/ui', 'dist/ui', { recursive: true });

// Bundle the facet packages to node-runnable JS (each self-contained).
const FACET = ['core', 'render-term', 'render-dom'];
for (const pkg of FACET) {
  const out = `dist/node_modules/@facet/${pkg}/index.js`;
  mkdirSync(dirname(out), { recursive: true });
  execSync(`npx esbuild node_modules/@facet/${pkg}/src/index.ts --bundle --platform=node --format=esm --outfile=${out}`, { stdio: 'inherit' });
  writeFileSync(
    `dist/node_modules/@facet/${pkg}/package.json`,
    JSON.stringify({ name: `@facet/${pkg}`, version: '0.0.0', type: 'module', main: 'index.js', exports: './index.js' }, null, 2),
  );
}
console.log('[build] dist/ ready (compiled ESM + ui assets + bundled facet)');
