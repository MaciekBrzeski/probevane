import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPolicy, gatherAnswers, buildSpec } from './build-spec.js';
import { classifyPrompt } from './classify.js';

function policyFile(obj: unknown): string {
  const f = join(mkdtempSync(join(tmpdir(), 'probevane-policy-')), 'p.json');
  writeFileSync(f, JSON.stringify(obj));
  return f;
}

describe('readPolicy', () => {
  it('reads a --answers policy file', async () => {
    const f = policyFile({ scope: 'one', ship: 'yes' });
    expect(await readPolicy(['--answers', f])).toEqual({ scope: 'one', ship: 'yes' });
  });
  it('returns null when --answers is absent', async () => {
    expect(await readPolicy(['--model', 'ollama'])).toBeNull();
  });
});

describe('gatherAnswers', () => {
  const qs = classifyPrompt('add tests to the repo').questions;
  it('prefers the policy file', async () => {
    const f = policyFile({ scope: 'one', ship: 'yes' });
    expect(await gatherAnswers(['--answers', f], qs)).toEqual({ scope: 'one', ship: 'yes' });
  });
  it('falls back to per-question defaults when non-interactive', async () => {
    const ans = await gatherAnswers([], qs); // no TTY in tests → lights-out defaults
    expect(ans.scope).toBe('repo');
    expect(ans.ship).toBe('no');
  });
});

describe('buildSpec', () => {
  it('assembles a defaulted write_tests spec (lights-out)', async () => {
    const s = await buildSpec('add unit tests', '/repo', ['--model', 'ollama']);
    expect(s.path).toBe('write_tests');
    expect(s.model).toBe('ollama');
    expect(s.decompose).toEqual({ perFile: true });
    expect(s.ship).toBe(false);
    expect(s.id).toMatch(/^[0-9a-f]{8}$/);
  });
  it('applies a policy file + --strict', async () => {
    const f = policyFile({ scope: 'one', ship: 'yes' });
    const s = await buildSpec('add tests', '/repo', ['--answers', f, '--strict']);
    expect(s.decompose).toEqual({ perFile: false });
    expect(s.ship).toBe(true);
    expect(s.strict).toBe(true);
  });
});
