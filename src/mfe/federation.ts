// Module Federation config parser (MFE Phase A). Pure + heuristic: extract the
// federation shape from a config file's TEXT without executing it (webpack
// ModuleFederationPlugin, vite plugin-federation, or a module-federation.config.*
// exporting the object). It's a fitness-function input — flags for a human/loop,
// not a bundler. No I/O: the scanner reads the file and hands the text here.

export interface SharedDep {
  singleton: boolean;
  version?: string; // requiredVersion / version if declared
}

export interface FederationConfig {
  name: string;
  remotes: string[]; // remote names the host consumes
  exposes: Record<string, string>; // exposed key (e.g. './Cart') → source path
  shared: Record<string, SharedDep>; // dep → { singleton, version }
}

const MARKERS = /ModuleFederationPlugin|@module-federation|['"]?federation['"]?\s*\(|exposes\s*:|remotes\s*:/;

/** True if the text looks like a Module Federation config. */
export function isFederationConfig(text: string): boolean {
  return MARKERS.test(text);
}

/** Slice the balanced `{...}` or `[...]` that begins at/after `from`. */
function sliceBalanced(text: string, from: number): string {
  const open = text[from];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return text.slice(from);
}

/** The `{...}`/`[...]` value of `key:` in `text`, or '' if absent. */
function blockFor(text: string, key: string): string {
  const m = text.match(new RegExp(`\\b${key}\\s*:\\s*[\\[{]`));
  if (m?.index === undefined) return '';
  const braceAt = m.index + m[0].length - 1;
  return sliceBalanced(text, braceAt);
}

/** Top-level keys of an object block (`{ 'a': …, b: … }` → ['a','b']). */
function objectKeys(block: string): string[] {
  const inner = block.slice(1, -1);
  const keys: string[] = [];
  for (const m of inner.matchAll(/(?:^|[,\x7b])\s*['"]?([A-Za-z0-9_./@-]+)['"]?\s*:/g)) keys.push(m[1]);
  return keys;
}

/** String entries of an array block (`['react','vue']` → ['react','vue']). */
function arrayEntries(block: string): string[] {
  return [...block.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function parseExposes(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!block.startsWith('{')) return out;
  for (const m of block.slice(1, -1).matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)) out[m[1]] = m[2];
  return out;
}

function parseShared(block: string): Record<string, SharedDep> {
  const out: Record<string, SharedDep> = {};
  if (!block) return out;
  // Array form: `shared: ['react', ...]` → shared but NOT singleton.
  if (block.startsWith('[')) {
    for (const dep of arrayEntries(block)) out[dep] = { singleton: false };
    return out;
  }
  // Object form: `react: { singleton: true, requiredVersion: '^18' }` or `react: '^18'`.
  const inner = block.slice(1, -1);
  for (const m of inner.matchAll(/['"]?([A-Za-z0-9_./@-]+)['"]?\s*:\s*(\x7b[^\x7d]*\x7d|['"][^'"]*['"])/g)) {
    const dep = m[1];
    const val = m[2];
    if (val.startsWith('{')) {
      out[dep] = {
        singleton: /\bsingleton\s*:\s*true\b/.test(val),
        version: val.match(/(?:requiredVersion|version)\s*:\s*['"]([^'"]+)['"]/)?.[1],
      };
    } else {
      out[dep] = { singleton: false, version: val.replace(/['"]/g, '') };
    }
  }
  return out;
}

/** Parse a Module Federation config from its source text, or null if none. */
export function parseFederation(text: string): FederationConfig | null {
  if (!isFederationConfig(text)) return null;
  const remotesBlock = blockFor(text, 'remotes');
  const exposesBlock = blockFor(text, 'exposes');
  return {
    name: text.match(/\bname\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? '',
    remotes: remotesBlock.startsWith('[') ? arrayEntries(remotesBlock) : objectKeys(remotesBlock),
    exposes: parseExposes(exposesBlock),
    shared: parseShared(blockFor(text, 'shared')),
  };
}
