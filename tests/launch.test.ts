import { describe, it, expect } from 'vitest';
import { validateLaunch, LAUNCH_OPS } from '../src/observe/launch.js';

describe('validateLaunch', () => {
  it('accepts a valid op + dir + flags', () => {
    const r = validateLaunch({ op: 'generate', dir: './app', flags: ['--kind', 'unit'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.op).toBe('generate');
      expect(r.plan.dir).toBe('./app');
      expect(r.plan.flags).toEqual(['--kind', 'unit']);
    }
  });

  it('rejects an op not on the allowlist', () => {
    const r = validateLaunch({ op: 'rm', dir: './app' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('op must be one of');
  });

  it('requires a dir', () => {
    const r = validateLaunch({ op: 'quality' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('dir is required');
  });

  it('rejects shell metacharacters in flags', () => {
    for (const bad of ['; rm -rf /', '$(whoami)', '`id`', 'a|b', 'a&b', 'a>b']) {
      const r = validateLaunch({ op: 'generate', dir: '.', flags: [bad] });
      expect(r.ok).toBe(false);
    }
  });

  it('rejects a non-object body', () => {
    expect(validateLaunch(null).ok).toBe(false);
    expect(validateLaunch('generate ./app').ok).toBe(false);
    expect(validateLaunch(42).ok).toBe(false);
  });

  it('defaults flags to empty', () => {
    const r = validateLaunch({ op: 'audit', dir: '.' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.flags).toEqual([]);
  });

  it('every allowlisted op validates', () => {
    for (const op of LAUNCH_OPS) {
      expect(validateLaunch({ op, dir: '.' }).ok).toBe(true);
    }
  });
});
