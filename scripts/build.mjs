// Build to dist/: compile src → dist (tsconfig.build.json) + copy runtime assets
// (src/ui/loop.html, read by `serve`). Imports already use .js extensions, so the
// emitted ESM runs on node directly — no tsx needed at install/runtime.
import { execSync } from 'node:child_process';
import { cpSync, rmSync, existsSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
if (existsSync('src/ui')) cpSync('src/ui', 'dist/ui', { recursive: true });
console.log('[build] dist/ ready (compiled ESM + ui assets)');
