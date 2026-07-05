// Facet's own quality gate — self-contained (no external tool). Facet's idiom is
// deliberately dense (one-line widget bodies, long gallery data rows), so line
// width is advisory; the HARD gate is bloat: files over 300 lines or functions
// whose body runs past 60 lines. gate.sh fails if any hard finding.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname; // engine/
const DIRS = ['core/src', 'render-term/src', 'render-dom/src', 'gallery/src'];
const MAX_FILE = 300;
const MAX_FN = 60;
const WIDE = 160; // advisory only — flags a genuinely runaway line, not the dense idiom
// Pure declarative data manifests grow with the library by design — length is not bloat.
const EXEMPT_FILE = new Set(['gallery/src/gallery.ts']);

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
  }
};
for (const d of DIRS) { try { walk(join(ROOT, d)); } catch { /* dir may not exist */ } }

const hard = [], warn = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const rel = f.slice(ROOT.length + 1);
  if (lines.length > MAX_FILE && !EXEMPT_FILE.has(rel)) hard.push(`${rel}: file ${lines.length} > ${MAX_FILE} lines`);
  lines.forEach((ln, i) => { if (ln.length > WIDE) warn.push(`${rel}:${i + 1}: line ${ln.length} cols`); });
  lines.forEach((ln, i) => {
    if (!/\b(function|=>)\b.*\{\s*$/.test(ln)) return;
    const indent = ln.match(/^\s*/)[0].length;
    for (let j = i + 1; j < Math.min(lines.length, i + MAX_FN + 2); j++) {
      if (lines[j].match(/^\s*/)[0].length <= indent && /^\s*\}/.test(lines[j])) return;
    }
    if (i + MAX_FN < lines.length) hard.push(`${rel}:${i + 1}: function body > ${MAX_FN} lines`);
  });
}

if (warn.length) { console.log(`[lint] ${warn.length} wide line(s) (advisory, >${WIDE} cols)`); }
if (hard.length) {
  console.error(`[lint] ${hard.length} bloat issue(s):`);
  for (const h of hard) console.error('  ' + h);
  process.exit(1);
}
console.log(`[lint] ${files.length} file(s): no bloat (≤${MAX_FILE}-line files, ≤${MAX_FN}-line fns)`);
