import { statePath } from '../util/state.js';
import { appendJsonl, readJsonl } from '../util/jsonl.js';

// Library-mutation audit trail (Phase 4). Every change to the cross-project
// learning library appends one record here so a long-running daemon (and the
// operator) can see what the harness has been writing into shared state — and
// when. Append-only JSONL under the state root (honors PROBEVANE_STATE); atomic
// like the ledger. Best-effort: an audit failure never breaks the mutation.
export const AUDIT_PATH = statePath('audit.jsonl');

export interface AuditEntry {
  ts: string;
  action: string; // e.g. 'library.save', 'library.prune'
  target: string; // what was touched (slug / path)
  detail?: Record<string, unknown>;
}

export async function recordAudit(
  e: Omit<AuditEntry, 'ts'> & { ts?: string },
  path = AUDIT_PATH,
): Promise<void> {
  const entry: AuditEntry = { ts: e.ts ?? new Date().toISOString(), ...e };
  await appendJsonl(path, entry).catch(() => {}); // never break the caller
}

export async function readAudit(path = AUDIT_PATH): Promise<AuditEntry[]> {
  return readJsonl<AuditEntry>(path);
}
