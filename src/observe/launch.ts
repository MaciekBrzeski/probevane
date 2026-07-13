// Launch-request validation (Phase 5 control center). Pure: the daemon's /run
// endpoint hands a parsed JSON body here; this enforces the op allowlist, requires
// a dir, and rejects shell-metachar injection in flags before any spawn. The
// daemon spawns with an arg array (no shell), so the metachar check is defense in
// depth — the allowlist is the real boundary.

export const LAUNCH_OPS = [
  'generate',
  'refactor',
  'feature',
  'fix',
  'repair',
  'factory',
  'quality',
  'audit',
  'review',
  'coverage',
  'impact',
] as const;
/** An operation the daemon is allowed to spawn — derived from the LAUNCH_OPS allowlist. */
export type LaunchOp = (typeof LAUNCH_OPS)[number];

/** A validated, spawnable launch request — produced only by validateLaunch();
 *  the daemon execs exactly this (arg array, no shell). */
export interface LaunchPlan {
  op: LaunchOp;
  dir: string;
  flags: string[];
}

/** validateLaunch() outcome: a spawnable plan, or the reason the body was rejected. */
export type LaunchResult = { ok: true; plan: LaunchPlan } | { ok: false; error: string };

/** Gate a /run body before any spawn: allowlisted op, non-empty dir, no shell
 *  metachars in flags — defense in depth on top of the shell-free spawn. */
export function validateLaunch(body: unknown, allowed: readonly string[] = LAUNCH_OPS): LaunchResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const op = String(b.op ?? '');
  const dir = String(b.dir ?? '');
  if (!allowed.includes(op)) return { ok: false, error: `op must be one of: ${allowed.join(', ')}` };
  if (!dir) return { ok: false, error: 'dir is required' };
  const flags = Array.isArray(b.flags) ? b.flags.map((f) => String(f)) : [];
  if (flags.some((f) => /[;&|`$<>\n\r]/.test(f)))
    return { ok: false, error: 'flags contain illegal characters' };
  return { ok: true, plan: { op: op as LaunchOp, dir, flags } };
}
