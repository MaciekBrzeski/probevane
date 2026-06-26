import { homedir } from 'node:os';
import { join } from 'node:path';

// Single source of truth for the cross-project state root. Default is the
// personal library dir; `PROBEVANE_STATE` overrides it so a per-repo / per-worker
// run can ISOLATE its ledger/traces/library/caveats/bridge from every other run
// (multi-tenant safety — concurrent factory runs must not share mutable state).
export function stateRoot(): string {
  return process.env.PROBEVANE_STATE ?? join(homedir(), '.local', 'share', 'probevane');
}

/** A path under the state root. */
export function statePath(...parts: string[]): string {
  return join(stateRoot(), ...parts);
}
