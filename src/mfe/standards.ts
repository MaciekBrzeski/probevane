import type { FederationConfig, SharedDep } from './federation.js';

// MFE standards rule-pack (Phase A) — the architectural fitness function for a
// Module-Federation polyrepo. Pure: given a repo's federation config + package.json
// + source files, emit violations against the four standards (boundaries, shared/
// singletons, runtime resilience, typed contracts). Cross-repo version alignment is
// a separate pure pass over every repo's shared map. The loop builds exactly what a
// gate enforces — this IS the spec for "best practices".

export const FRAMEWORKS = ['react', 'react-dom', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact'];

export interface MfeViolation {
  rule: 'boundary' | 'singleton' | 'shared-missing' | 'resilience' | 'contract' | 'version-align';
  severity: 'error' | 'warn';
  message: string;
  file?: string;
}

export interface MfeRepoInput {
  config: FederationConfig;
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  sources: { file: string; source: string }[];
  designSystem?: string; // optional DS package name to enforce non-deep imports
}

export interface MfeAudit {
  name: string;
  isHost: boolean;
  violations: MfeViolation[];
  errors: number;
  warns: number;
  grade: number; // 0..100
}

/** import specifiers (static `from '…'` + dynamic `import('…')`). */
function importSpecs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

const INTERNAL = /(^|\/)(src|dist|lib|build|internal|node_modules)(\/|$)/;

/** A federated import that reaches past a remote's public (exposed) surface. */
function isDeepRemoteImport(spec: string, remotes: string[]): boolean {
  const seg = spec.split('/');
  if (!remotes.includes(seg[0])) return false;
  return seg.length > 2 || INTERNAL.test(spec); // `cart/Cart` ok; `cart/a/b` or `cart/src/…` deep
}

// R1 — boundaries: no deep cross-remote imports; design-system not deep-imported.
function ruleBoundaries(i: MfeRepoInput): MfeViolation[] {
  const v: MfeViolation[] = [];
  for (const { file, source } of i.sources) {
    for (const spec of importSpecs(source)) {
      if (isDeepRemoteImport(spec, i.config.remotes))
        v.push({ rule: 'boundary', severity: 'error', file, message: `deep import past a remote's public API: ${spec}` });
      else if (i.designSystem && spec.startsWith(i.designSystem + '/') && INTERNAL.test(spec))
        v.push({ rule: 'boundary', severity: 'warn', file, message: `deep import into the design system: ${spec}` });
    }
  }
  return v;
}

// R2 — shared deps: framework deps must be shared as singletons.
function ruleSingletons(i: MfeRepoInput): MfeViolation[] {
  const v: MfeViolation[] = [];
  const deps = i.pkg.dependencies ?? {};
  for (const dep of FRAMEWORKS) {
    if (!(dep in deps)) continue;
    const s: SharedDep | undefined = i.config.shared[dep];
    if (!s) v.push({ rule: 'shared-missing', severity: 'error', message: `framework dep "${dep}" is not in Module Federation shared` });
    else if (!s.singleton) v.push({ rule: 'singleton', severity: 'error', message: `shared "${dep}" must be a singleton` });
  }
  return v;
}

// R3 — resilience: a host must wrap federated mounts in Suspense + an error boundary.
function ruleResilience(i: MfeRepoInput): MfeViolation[] {
  if (i.config.remotes.length === 0) return [];
  const v: MfeViolation[] = [];
  const usesRemote = (s: string) => importSpecs(s).some((spec) => i.config.remotes.includes(spec.split('/')[0]));
  for (const { file, source } of i.sources)
    if (usesRemote(source) && !/\bSuspense\b/.test(source))
      v.push({ rule: 'resilience', severity: 'warn', file, message: 'federated import without a Suspense boundary' });
  const hasBoundary = i.sources.some((s) => /ErrorBoundary|componentDidCatch|getDerivedStateFromError/.test(s.source));
  if (!hasBoundary) v.push({ rule: 'resilience', severity: 'warn', message: 'host has no error boundary for remote-load failures' });
  return v;
}

// R4 — contracts: exposed modules should be typed (ts/tsx, not js/jsx).
function ruleContracts(i: MfeRepoInput): MfeViolation[] {
  const v: MfeViolation[] = [];
  for (const [key, path] of Object.entries(i.config.exposes))
    if (/\.(jsx?|mjs)$/.test(path))
      v.push({ rule: 'contract', severity: 'warn', message: `exposed "${key}" is untyped (${path}) — expose a typed (.ts/.tsx) module` });
  return v;
}

const grade = (errors: number, warns: number) => Math.max(0, 100 - errors * 5 - warns * 2);

/** Audit one repo against the four MFE standards. */
export function auditRepo(input: MfeRepoInput): MfeAudit {
  const violations = [
    ...ruleBoundaries(input),
    ...ruleSingletons(input),
    ...ruleResilience(input),
    ...ruleContracts(input),
  ];
  const errors = violations.filter((x) => x.severity === 'error').length;
  const warns = violations.length - errors;
  return { name: input.config.name, isHost: input.config.remotes.length > 0, violations, errors, warns, grade: grade(errors, warns) };
}

export interface RepoShared {
  name: string;
  shared: Record<string, SharedDep>;
  pkg: { dependencies?: Record<string, string> };
}

/** Cross-repo: a shared framework dep declared at different versions across repos
 *  breaks the singleton guarantee at runtime. One violation per misaligned dep. */
export function versionAlign(repos: RepoShared[]): MfeViolation[] {
  const v: MfeViolation[] = [];
  for (const dep of FRAMEWORKS) {
    const seen = new Map<string, string[]>(); // version → repo names
    for (const r of repos) {
      const ver = r.shared[dep]?.version ?? r.pkg.dependencies?.[dep];
      if (ver) (seen.get(ver) ?? seen.set(ver, []).get(ver)!).push(r.name || '(unnamed)');
    }
    if (seen.size > 1) {
      const detail = [...seen.entries()].map(([ver, names]) => `${ver} (${names.join(',')})`).join(' vs ');
      v.push({ rule: 'version-align', severity: 'error', message: `shared "${dep}" version misaligned across repos: ${detail}` });
    }
  }
  return v;
}

export function formatMfe(violations: MfeViolation[]): string {
  return violations
    .map((x) => `${x.file ? x.file + ': ' : ''}${x.severity}: [${x.rule}] ${x.message}`)
    .join('\n');
}
