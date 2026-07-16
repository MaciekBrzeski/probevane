// @generated FROM vane/profiles.vane — do not edit. Regenerate: probevane vane --write
import type { RunScope } from '../adapters/adapter.js';
import type { ProfileName, ProfileOpts, Segment } from './profile-types.js';
import { seg, preamble, greenGates, optInGates, harvest } from './profile-subs.js';
import { behaviorLock, renderGate } from './runes/index.js';

const write_tests = (opts: ProfileOpts, scope: RunScope): Segment[] => [
  seg('preamble', preamble(opts.kind, { noRegression: true })),
  seg('green-gates', greenGates(scope, { acceptance: { scope, minTests: opts.minTests, minCoverage: opts.minCoverage, shellChecks: opts.shellChecks } })),
  seg('opt-in', optInGates(opts, scope, { extras: true })),
  seg('harvest', harvest({ full: true })),
];

const feature = (opts: ProfileOpts): Segment[] => [
  seg('preamble', preamble('unit', { redFirst: true, noRegression: true })),
  seg('green-gates', greenGates('unit', { acceptance: { scope: 'unit', minTests: opts.minTests ?? 1 } })),
  seg('opt-in', optInGates(opts, 'unit', { mfe: true })),
  seg('harvest', harvest({ full: true })),
];

const repair = (opts: ProfileOpts): Segment[] => [
  seg('preamble', preamble('unit')),
  seg('green-gates', greenGates('unit', { fullSuite: true })),
  seg('opt-in', optInGates(opts, 'unit', { mfe: true })),
  seg('harvest', harvest({ full: true })),
];

const refactor = (opts: ProfileOpts): Segment[] => [
  seg('preamble', preamble('unit')),
  seg('safety-net', [behaviorLock()]),
  seg('opt-in', optInGates(opts, 'unit', { mfe: true })),
  seg('harvest', harvest()),
];

const document = (): Segment[] => [
  seg('preamble', preamble('unit')),
  seg('safety-net', [behaviorLock()]),
  seg('harvest', harvest()),
];

const visual = (opts: ProfileOpts): Segment[] => [
  seg('preamble', preamble('unit')),
  seg('safety-net', [behaviorLock()]),
  ...(opts.render ? [seg('green-gates', [renderGate(opts.render!)])] : []),
  seg('harvest', harvest()),
];

const bare = (): Segment[] => [];

export const SEGMENT_BUILDERS: Record<ProfileName, (opts: ProfileOpts, scope: RunScope) => Segment[]> = {
  write_tests, feature, repair, refactor, document, visual, bare, fix: repair, migrate: refactor,
};
