import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interpret, propose, resolveHistoryDirs } from '../src/server/assistant.js';

// The assistant driver is deterministic + $0 — no brain, no run. These pin the
// NL→launch classification and the post-run proposal ranking on temp projects.

/** A minimal react-vitest project so an adapter resolves + gatherPlan runs. */
function mkProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-asst-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { react: '18' }, devDependencies: { vitest: '2' } }));
  writeFileSync(join(dir, 'src', 'App.tsx'), 'export function App() { return null; }\n');
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(dir, join(f, '..')), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

describe('interpret — NL → confirmable launch plan', () => {
  it('classifies "add unit tests" to the generate op with a valid launch body', async () => {
    const dir = mkProject();
    const r = await interpret(dir, 'add unit tests for the app');
    expect(r.ok).toBe(true);
    expect(r.op).toBe('generate');
    expect(r.kind).toBe('unit');
    expect(r.launch).toMatchObject({ op: 'generate', dir });
    expect(r.launch.flags).toContain('--kind');
    expect(r.summary).toContain('generate');
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies a refactor request to the refactor path carrying --task', async () => {
    const dir = mkProject();
    const r = await interpret(dir, 'refactor the giant App component into smaller pieces');
    expect(r.op).toBe('refactor');
    expect(r.launch.flags).toContain('--task');
    rmSync(dir, { recursive: true, force: true });
  });

  it('threads a model override into the launch flags', async () => {
    const dir = mkProject();
    const r = await interpret(dir, 'add tests', 'sonnet');
    expect(r.launch.flags).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    expect(r.summary).toContain('sonnet');
    rmSync(dir, { recursive: true, force: true });
  });

  it('surfaces assumptions (the classifier questions) for the card', async () => {
    const dir = mkProject();
    const r = await interpret(dir, 'add tests');
    expect(r.assumptions.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('ok:false with an error for a non-directory and an empty prompt', async () => {
    expect((await interpret('/no/such/dir', 'x')).ok).toBe(false);
    const dir = mkProject();
    const empty = await interpret(dir, '   ');
    expect(empty.ok).toBe(false);
    expect(empty.error).toMatch(/empty/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('propose — post-run $0 improvement follow-ups', () => {
  it('turns an untested source file into a runnable generate proposal', async () => {
    // An untested source module → gatherPlan yields a generate item.
    const dir = mkProject({ 'src/util.ts': 'export const add = (a: number, b: number) => a + b;\n' });
    const ps = await propose(dir);
    const gen = ps.find((p) => p.source === 'plan' && p.op === 'generate');
    expect(gen).toBeDefined();
    expect(gen!.flags).toContain('--only');
    rmSync(dir, { recursive: true, force: true });
  });

  it('never throws on a repo with no adapter (returns [] or structural-only)', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'pv-bare-'));
    const ps = await propose(bare);
    expect(Array.isArray(ps)).toBe(true);
    rmSync(bare, { recursive: true, force: true });
  });
});

describe('resolveHistoryDirs — path dropdown history', () => {
  const isDir = (existing: string[]) => (p: string) => existing.includes(p);

  it('prefers a recorded workdir, skipping throwaway worktrees', () => {
    const recs = [
      { dir: '/w/real-a', label: 'generate:real-a' },
      { dir: '/tmp/probevane-wt-feature-1/x', label: 'feature:x' },
    ];
    const out = resolveHistoryDirs(recs, ['/roots'], isDir(['/w/real-a']));
    expect(out).toEqual(['/w/real-a']); // worktree dropped (not real / filtered)
  });

  it('resolves a label target against roots when no dir is stored', () => {
    const recs = [{ label: 'generate:react-shop' }, { label: 'refactor:probevane' }];
    const out = resolveHistoryDirs(recs, ['/repo/fixtures', '/work'], isDir(['/repo/fixtures/react-shop', '/work/probevane']));
    expect(out).toEqual(['/repo/fixtures/react-shop', '/work/probevane']);
  });

  it('dedupes and drops targets that resolve nowhere', () => {
    const recs = [
      { label: 'generate:probevane' },
      { label: 'refactor:probevane' }, // same target → deduped
      { label: 'feature:gone' }, // resolves nowhere → dropped
    ];
    const out = resolveHistoryDirs(recs, ['/work'], isDir(['/work/probevane']));
    expect(out).toEqual(['/work/probevane']);
  });
});
