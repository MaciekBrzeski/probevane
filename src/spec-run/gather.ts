import { readFile } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { parseGaps } from '../coverage/gaps.js';
import { scanProject } from '../quality/scan.js';
import { scanMfe } from '../mfe/scan.js';
import { buildPlan, untestedTargets, type ProjectPlan } from '../commands/plan/build.js';
import type { TestKind } from '../adapters/adapter.js';

// Gather the read-only signals ($0, no LLM) and rank them into a ProjectPlan — the
// same combination `probevane plan` prints, extracted so the dark-factory intake +
// decomposition reuse it verbatim (one source of the untested/gap/quality signals).

export async function gatherPlan(dir: string, kind: TestKind): Promise<{ adapterId: string; plan: ProjectPlan; mfe: boolean }> {
  const adapter = await selectAdapterOrThrow(dir);
  const targets = await adapter.discover(dir, kind).catch(() => []);
  const specs = await adapter.specFiles(dir).catch(() => []);
  const specTexts = await Promise.all(specs.map((f) => readFile(f, 'utf8').catch(() => '')));
  const untested = untestedTargets(targets, specs, specTexts);
  const gaps = await parseGaps(dir).catch(() => []);
  const quality = await scanProject(dir).catch(() => null);
  const mfe = await scanMfe(dir).catch(() => null);
  const sev = <T extends { severity: string }>(vs: T[]) => vs.filter((v) => v.severity === 'error');
  const toErr = (v: { file?: string; rule: string; message: string }) =>
    ({ file: v.file ?? '(project)', message: `[${v.rule}] ${v.message}` });
  const plan = buildPlan({
    untested,
    coverageGaps: gaps.map((g) => g.file).filter((f) => !untested.includes(f)),
    qualityErrors: quality ? sev(quality.violations).map(toErr) : [],
    mfeErrors: mfe ? sev(mfe.audit.violations).map(toErr) : [],
  });
  return { adapterId: adapter.id, plan, mfe: !!mfe };
}
