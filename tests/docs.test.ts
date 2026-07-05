import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocsDigest } from '../src/loop/digest.js';
import { RunCtx } from '../src/loop/ctx.js';
import { nullAdapter } from '../src/adapters/null-adapter.js';
import {
  docsScopeGuard, docStructureGate, docReferenceGate, docsAcceptance, extractRefs,
} from '../src/loop/runes/docs.js';

const ctx = (workdir: string) => new RunCtx(workdir, nullAdapter, 'docs');
const write = (call: object) => ({ id: 't', name: 'write_file', input: call }) as never;

describe('buildDocsDigest (stack-agnostic)', () => {
  it('detects languages, manifest, and structure of probevane itself', () => {
    const d = buildDocsDigest(process.cwd());
    expect(d).toContain('PROJECT DIGEST');
    expect(d).toContain('TypeScript');
    expect(d).toContain('package.json');
    expect(d).toContain('Entry points');
    expect(d).toContain('File tree');
  });
});

describe('docsScopeGuard', () => {
  const g = docsScopeGuard();
  it('blocks writing a code file', async () => {
    const d = await g.beforeToolCall!(write({ path: 'src/foo.ts', contents: 'x' }), ctx('.'));
    expect(d.kind).toBe('block');
  });
  it('allows writing a markdown file', async () => {
    const d = await g.beforeToolCall!(write({ path: 'docs/guide.md', contents: '# x' }), ctx('.'));
    expect(d.kind).toBe('allow');
  });
});

describe('doc gates', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pv-docs-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'real.ts'), 'export const x = 1;\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const SECTIONS = ['Overview', 'Architecture'];

  it('docStructureGate blocks a missing section, passes a complete guide', async () => {
    const g = docStructureGate('g.md', SECTIONS);
    writeFileSync(join(dir, 'g.md'), '# Title\n\n## Overview\n' + 'a'.repeat(250) + '\n');
    expect((await g.shouldStop!(ctx(dir))).kind).toBe('block'); // missing Architecture
    writeFileSync(join(dir, 'g.md'), '# Title\n\n## Overview\n' + 'a'.repeat(250) + '\n\n## Architecture\n' + 'b'.repeat(250) + '\n');
    expect((await g.shouldStop!(ctx(dir))).kind).toBe('allow');
  });

  it('docReferenceGate flags a fabricated path, passes a real one', async () => {
    const g = docReferenceGate('g.md');
    writeFileSync(join(dir, 'g.md'), 'See `src/real.ts` and `src/ghost.ts`.\n');
    const blocked = await g.shouldStop!(ctx(dir));
    expect(blocked.kind).toBe('block');
    if (blocked.kind === 'block') expect(blocked.inject).toContain('src/ghost.ts');
    writeFileSync(join(dir, 'g.md'), 'Only real refs: `src/real.ts`.\n');
    expect((await g.shouldStop!(ctx(dir))).kind).toBe('allow');
  });

  it('docsAcceptance blocks a too-short guide', async () => {
    const g = docsAcceptance('g.md', 800);
    writeFileSync(join(dir, 'g.md'), '# Title\nshort\n');
    expect((await g.shouldStop!(ctx(dir))).kind).toBe('block');
  });
});

describe('extractRefs', () => {
  it('extracts link targets + path-like backticks, ignores prose/urls', () => {
    const md = 'Run `npm test` then see [engine](src/loop/engine.ts) and `src/cli/docs.ts`. Visit `https://x.com`.';
    const refs = extractRefs(md);
    expect(refs).toContain('src/loop/engine.ts');
    expect(refs).toContain('src/cli/docs.ts');
    expect(refs).not.toContain('npm test');
    expect(refs.some((r) => r.includes('x.com'))).toBe(false);
  });
});
