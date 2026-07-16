import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateProfiles } from '../src/vane/gen-profiles.js';
import { clearVaneCache } from '../src/vane/load.js';

// Drives gen-profiles' CLOSED token tables: valid forms generate the expected
// TS, and every `bail` branch throws with the offending line's position.

const saved = process.env.PROBEVANE_ROOT;
afterEach(() => {
  if (saved === undefined) delete process.env.PROBEVANE_ROOT;
  else process.env.PROBEVANE_ROOT = saved;
  clearVaneCache();
});

/** Temp root whose profiles.vane holds `body`; returns the root. */
function withProfiles(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pv-gen-'));
  mkdirSync(join(root, 'vane'), { recursive: true });
  writeFileSync(join(root, 'vane', 'profiles.vane'), body);
  process.env.PROBEVANE_ROOT = root;
  clearVaneCache();
  return root;
}

describe('generateProfiles — valid forms', () => {
  it('emits @generated header, builders, and the SEGMENT_BUILDERS record with aliases', () => {
    const root = withProfiles([
      'profile write_tests',
      '  preamble kind noRegression',
      '  green-gates scope acceptance(scope, minTests, minCoverage, shellChecks)',
      '  opt-in scope extras',
      '  harvest full',
      'profile refactor',
      '  preamble unit',
      '  safety-net behavior_lock',
      '  harvest',
      'profile visual',
      '  if render: green-gates render_gate(render)',
      'profile bare',
      'alias fix = refactor',
    ].join('\n'));
    const out = generateProfiles();
    expect(out.startsWith('// @generated FROM vane/profiles.vane')).toBe(true);
    expect(out).toContain('const write_tests = (opts: ProfileOpts, scope: RunScope): Segment[] =>');
    expect(out).toContain("preamble(opts.kind, { noRegression: true })");
    expect(out).toContain('acceptance: { scope, minTests: opts.minTests, minCoverage: opts.minCoverage, shellChecks: opts.shellChecks }');
    expect(out).toContain("seg('safety-net', [behaviorLock()])");
    expect(out).toContain('const bare = (): Segment[] => [];'); // no opts/scope use
    expect(out).toContain("...(opts.render ? [seg('green-gates', [renderGate(opts.render!)])] : [])");
    expect(out).toContain('write_tests, refactor, visual, bare, fix: refactor');
    rmSync(root, { recursive: true, force: true });
  });

  it('acceptance ?? default + unit-literal scope render correctly', () => {
    const root = withProfiles([
      'profile feature',
      '  green-gates unit acceptance(unit, minTests ?? 1)',
    ].join('\n'));
    expect(generateProfiles()).toContain("greenGates('unit', { acceptance: { scope: 'unit', minTests: opts.minTests ?? 1 } })");
    rmSync(root, { recursive: true, force: true });
  });
});

describe('generateProfiles — every bail branch throws with file:line', () => {
  const cases: [string, string, RegExp][] = [
    ['unknown segment', 'profile p\n  bogus x', /profiles\.vane:2: unknown segment 'bogus'/],
    ['preamble bad kind', 'profile p\n  preamble sideways', /preamble: unknown kind 'sideways'/],
    ['preamble bad option', 'profile p\n  preamble unit wat', /preamble: unknown option 'wat'/],
    ['green-gates bad scope', 'profile p\n  green-gates sideways', /green-gates: unknown scope 'sideways'/],
    ['green-gates bad option', 'profile p\n  green-gates unit weird', /green-gates: unknown option 'weird'/],
    ['acceptance bad scope', 'profile p\n  green-gates unit acceptance(sideways)', /acceptance: unknown scope 'sideways'/],
    ['acceptance bad field', 'profile p\n  green-gates unit acceptance(unit, bogusField)', /acceptance: unknown field 'bogusField'/],
    ['safety-net bad rune', 'profile p\n  safety-net not_a_rune', /safety-net: unknown rune 'not_a_rune'/],
    ['opt-in bad scope', 'profile p\n  opt-in sideways', /opt-in: unknown scope 'sideways'/],
    ['opt-in bad option', 'profile p\n  opt-in unit weird', /opt-in: unknown option 'weird'/],
    ['harvest bad option', 'profile p\n  harvest partial', /harvest: unknown option 'partial'/],
  ];
  it.each(cases)('%s', (_name, body, re) => {
    const root = withProfiles(body);
    expect(() => generateProfiles()).toThrow(re);
    rmSync(root, { recursive: true, force: true });
  });
});
