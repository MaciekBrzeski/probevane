import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { showFile } from '../../util/git.js';
import {
  analyzeProject,
  formatQuality,
  DEFAULT_QUALITY,
  type QualityConfig,
  type QualityReport,
} from '../../quality/analyze.js';

// quality_gate (opt-in) — a finish condition over the SOURCE the run edited:
// file size, function length / complexity / nesting, etc. Baseline-aware: it
// blocks only when an edited file has MORE error-severity violations than it did
// at the run's checkpoint (so refactoring an already-large file isn't punished —
// only making it worse, or adding a new file over the bar, is). New files
// baseline to zero. Test files are ignored (audit_gate covers those). Without a
// git checkpoint it falls back to an absolute check (any error blocks).
const SRC = /\.(tsx|ts|jsx|js)$/;
const TEST = /\.(test|spec|d)\.[tj]sx?$/;

/** Worst (max) value per error-rule — file-size LOC, worst function's lines, etc.
 *  Comparing these vs the baseline catches a file/function growing WORSE even when
 *  the raw error COUNT is unchanged (a 15-line over-limit file vs a 400-line one
 *  are both "1 file-size error"). */
function worstByRule(report: QualityReport): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of report.violations)
    if (v.severity === 'error') m.set(v.rule, Math.max(m.get(v.rule) ?? 0, v.value));
  return m;
}

function analyze(file: string, source: string, cfg: QualityConfig): QualityReport {
  return analyzeProject([{ file, source }], cfg);
}

function systemPrompt(cfg: QualityConfig): string {
  return [
    'CODE QUALITY (enforced by a quality gate on the source you edit): keep files',
    `under ${cfg.maxFileLoc} lines and functions under ${cfg.maxFnLoc} lines /`,
    `complexity ${cfg.maxComplexity} / nesting ${cfg.maxNesting}. Do not let an edited`,
    'file regress past its starting quality; extract helpers instead of growing one file.',
  ].join(' ');
}

interface Regression {
  file: string;
  rules: string[];
  report: string;
}

/** Analyze one edited file vs its checkpoint baseline; returns a regression or null. */
async function fileRegression(ctx: RunCtx, cfg: QualityConfig, f: string): Promise<Regression | null> {
  const nowSrc = await readFile(join(ctx.workdir, f), 'utf8').catch(() => '');
  if (!nowSrc) return null;
  const report = analyze(f, nowSrc, cfg);
  if (report.errors === 0) return null;
  const beforeSrc = await showFile(ctx.workdir, ctx.checkpointSha, f);
  const before = worstByRule(analyze(f, beforeSrc, cfg)); // empty source → empty map
  const now = worstByRule(report);
  // A rule regresses when its worst value now exceeds the baseline (or is new).
  const worseRules = [...now].filter(([r, v]) => v > (before.get(r) ?? 0)).map(([r]) => r);
  if (worseRules.length === 0) return null;
  const errs = report.violations.filter(
    (v) => v.severity === 'error' && worseRules.includes(v.rule),
  );
  return { file: f, rules: worseRules, report: formatQuality({ ...report, violations: errs }) };
}

async function collectRegressions(ctx: RunCtx, cfg: QualityConfig, edited: string[]): Promise<Regression[]> {
  const regressed: Regression[] = [];
  for (const f of edited) {
    const r = await fileRegression(ctx, cfg, f);
    if (r) regressed.push(r);
  }
  return regressed;
}

function blockRegressed(regressed: Regression[]): RuneDecision {
  const first = regressed[0];
  return block(
    `quality_gate: ${regressed.length} edited file(s) regressed code quality`,
    `FIX THIS FIRST (${first.file} worsened: ${first.rules.join(', ')}):\n${first.report}\n\n` +
      `Refactor to get back to (or under) where it started — split large files/functions, ` +
      `reduce nesting/complexity. Pre-existing issues you didn't worsen are fine.`,
  );
}

async function evalQuality(ctx: RunCtx, cfg: QualityConfig): Promise<RuneDecision> {
  const edited = [...ctx.editedFiles]
    .map((f) => f.replace(/^\.\//, ''))
    .filter((f) => SRC.test(f) && !TEST.test(f));
  if (edited.length === 0) return ALLOW; // run touched no source of ours
  const regressed = await collectRegressions(ctx, cfg, edited);
  if (regressed.length === 0) return ALLOW;
  return blockRegressed(regressed);
}

export function qualityGate(overrides?: Partial<QualityConfig>): Rune {
  const cfg: QualityConfig = { ...DEFAULT_QUALITY, ...(overrides ?? {}) };
  return {
    name: 'quality_gate',

    systemPromptAddition(): string {
      return systemPrompt(cfg);
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      return evalQuality(ctx, cfg);
    },
  };
}
