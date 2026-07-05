// Dist smoke test — the `dist build` gate only proves dist COMPILES; it never
// RUNS it, so an unrunnable dist (bare @facet/* imports resolving to facet's
// extensionless TS source) ships green — exactly the ERR_MODULE_NOT_FOUND that
// broke `probevane tui`. This runs the packaged dist: a CLI that exits cleanly
// + the full TUI module graph (which pulls the facet drawing engine). Any
// resolution/execution break fails here.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const die = (msg) => { console.error(`[smoke] FAIL — ${msg}`); process.exit(1); };

if (!existsSync(join(ROOT, 'dist/cli/help.js'))) die('dist not built — run `npm run build` first');

// 1) a CLI entry runs to completion under plain node (no tsx).
try {
  execFileSync('node', [join(ROOT, 'dist/cli/help.js')], { stdio: 'ignore' });
} catch (e) { die(`\`node dist/cli/help.js\` crashed: ${e.message}`); }

// 2) the whole TUI module graph imports (screens → views/panes/*-widgets →
//    facet bridge → @facet/core + @facet/render-term). This is the graph that
//    crashed from a checkout; if the bundled facet under dist/node_modules is
//    missing/broken it throws here.
const MODULES = ['dist/tui/screens.js', 'dist/tui/views.js', 'dist/tui/cost-widgets.js', 'dist/tui/console-widgets.js', 'dist/ui/theme.js'];
for (const m of MODULES) {
  try { await import(pathToFileURL(join(ROOT, m)).href); }
  catch (e) { die(`import ${m}: ${e.message}`); }
}

console.log(`[smoke] dist runnable — help CLI + ${MODULES.length} facet-touching modules loaded`);
