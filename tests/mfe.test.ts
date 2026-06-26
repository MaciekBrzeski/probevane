import { describe, it, expect } from 'vitest';
import { parseFederation, isFederationConfig } from '../src/mfe/federation.js';
import { auditRepo, versionAlign, type MfeRepoInput } from '../src/mfe/standards.js';

const WEBPACK = `
new ModuleFederationPlugin({
  name: 'host',
  remotes: { cart: 'cart@http://localhost:3001/remoteEntry.js', profile: 'profile@/p.js' },
  shared: { react: { singleton: true, requiredVersion: '^18.2.0' }, 'react-dom': { singleton: true } },
});
`;

const VITE = `
federation({
  name: 'cart',
  exposes: { './Cart': './src/Cart.tsx', './legacy': './src/legacy.js' },
  shared: ['react', 'react-dom'],
});
`;

describe('parseFederation', () => {
  it('parses the webpack host form (remotes + singleton shared)', () => {
    expect(isFederationConfig(WEBPACK)).toBe(true);
    const c = parseFederation(WEBPACK)!;
    expect(c.name).toBe('host');
    expect(c.remotes.sort()).toEqual(['cart', 'profile']);
    expect(c.shared.react).toEqual({ singleton: true, version: '^18.2.0' });
    expect(c.shared['react-dom'].singleton).toBe(true);
  });

  it('parses the vite remote form (exposes + array shared = non-singleton)', () => {
    const c = parseFederation(VITE)!;
    expect(c.name).toBe('cart');
    expect(c.exposes['./Cart']).toBe('./src/Cart.tsx');
    expect(c.exposes['./legacy']).toBe('./src/legacy.js');
    expect(c.shared.react.singleton).toBe(false); // array form shares without singleton
  });

  it('returns null for a non-federation file', () => {
    expect(parseFederation('export const x = 1;')).toBeNull();
  });
});

const base = (over: Partial<MfeRepoInput> = {}): MfeRepoInput => ({
  config: { name: 'host', remotes: ['cart'], exposes: {}, shared: { react: { singleton: true } } },
  pkg: { dependencies: { react: '^18.2.0' } },
  sources: [],
  ...over,
});

describe('auditRepo', () => {
  it('flags a deep cross-remote import (boundary error)', () => {
    const r = auditRepo(base({ sources: [{ file: 'a.ts', source: "import x from 'cart/src/internal/util';" }] }));
    expect(r.violations.some((v) => v.rule === 'boundary' && v.severity === 'error')).toBe(true);
  });

  it('allows a public remote import (the exposed key)', () => {
    const r = auditRepo(base({ sources: [{ file: 'a.ts', source: "import Cart from 'cart/Cart';\nimport { Suspense } from 'react';\nclass EB { componentDidCatch(){} }" }] }));
    expect(r.violations.some((v) => v.rule === 'boundary')).toBe(false);
  });

  it('errors when a framework dep is shared but not a singleton', () => {
    const r = auditRepo(base({ config: { name: 'h', remotes: [], exposes: {}, shared: { react: { singleton: false } } } }));
    expect(r.violations.some((v) => v.rule === 'singleton')).toBe(true);
  });

  it('errors when a framework dep is not shared at all', () => {
    const r = auditRepo(base({ config: { name: 'h', remotes: [], exposes: {}, shared: {} } }));
    expect(r.violations.some((v) => v.rule === 'shared-missing')).toBe(true);
  });

  it('warns a host with a federated import lacking Suspense + an error boundary', () => {
    const r = auditRepo(base({ sources: [{ file: 'App.tsx', source: "import Cart from 'cart/Cart';\nexport const App = () => <Cart/>;" }] }));
    const res = r.violations.filter((v) => v.rule === 'resilience');
    expect(res.length).toBeGreaterThanOrEqual(2); // missing Suspense + missing error boundary
  });

  it('warns an untyped (.js) expose', () => {
    const r = auditRepo(base({ config: { name: 'cart', remotes: [], exposes: { './Cart': './src/Cart.js' }, shared: {} }, pkg: {} }));
    expect(r.violations.some((v) => v.rule === 'contract')).toBe(true);
  });
});

describe('versionAlign (cross-repo)', () => {
  const repo = (name: string, ver: string) => ({ name, shared: { react: { singleton: true, version: ver } }, pkg: {} });
  it('flags a shared dep at different versions across repos', () => {
    const v = versionAlign([repo('host', '^18.2.0'), repo('cart', '^17.0.0')]);
    expect(v.some((x) => x.rule === 'version-align')).toBe(true);
  });
  it('passes when versions match', () => {
    expect(versionAlign([repo('host', '^18.2.0'), repo('cart', '^18.2.0')])).toEqual([]);
  });
});
