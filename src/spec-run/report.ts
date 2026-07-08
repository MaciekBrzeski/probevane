import type { RunSpec } from './runspec.js';
import type { RunRecord } from '../cost/ledger.js';
import { resolve } from 'node:path';

// Roll the ledger up against the batch's child specs into an async "control room"
// view: which units accepted (+shipped), which parked on a deterministic give-up
// (with the stop reason), which are still pending. This is what a human checks
// after a dark run instead of watching it.

export type UnitStatus = 'accepted' | 'parked' | 'pending';

export interface ReportRow {
  id: string;
  target: string; // the --only file, or the repo
  status: UnitStatus;
  stopReason?: string;
  tookOver?: boolean;
}

export interface DarkReport {
  rows: ReportRow[];
  accepted: number;
  parked: number;
  pending: number;
  summary: string;
}

const stem = (p?: string) => (p ? p.split('/').pop()!.replace(/\.[a-z]+$/, '') : '');

/** The target segment of a run label ("generate:foo" → "foo"). */
const labelTarget = (label: string) => (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label);

/** Newest ledger record for a spec — matched by dir + (when scoped) the target
 *  basename encoded in the run label ("generate:foo"). Records arrive ascending
 *  by ts, so the last match is the newest. */
function recordFor(spec: RunSpec, records: RunRecord[]): RunRecord | undefined {
  const dir = resolve(spec.dir);
  const want = stem(spec.only);
  let hit: RunRecord | undefined;
  for (const r of records) {
    if (r.dir && resolve(r.dir) !== dir) continue;
    if (want && stem(labelTarget(r.label)) !== want) continue;
    hit = r;
  }
  return hit;
}

/** Build the batch report from the child specs + the merged ledger. */
export function buildDarkReport(specs: RunSpec[], records: RunRecord[]): DarkReport {
  const rows: ReportRow[] = specs.map((s) => {
    const rec = recordFor(s, records);
    const target = s.only ?? '(repo)';
    if (!rec) return { id: s.id, target, status: 'pending' };
    if (rec.accepted) return { id: s.id, target, status: 'accepted', tookOver: rec.tookOver };
    return { id: s.id, target, status: 'parked', stopReason: rec.stopReason, tookOver: rec.tookOver };
  });
  const accepted = rows.filter((r) => r.status === 'accepted').length;
  const parked = rows.filter((r) => r.status === 'parked').length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  return {
    rows,
    accepted,
    parked,
    pending,
    summary: `${specs.length} unit(s): ${accepted} accepted, ${parked} parked, ${pending} pending`,
  };
}

/** Human-readable report block. */
export function formatDarkReport(r: DarkReport): string {
  const line = (row: ReportRow) => {
    const mark = row.status === 'accepted' ? '✓' : row.status === 'parked' ? '⏸' : '·';
    const extra = row.status === 'parked' ? ` (${row.stopReason ?? 'unknown'})` : row.tookOver ? ' (takeover)' : '';
    return `  ${mark} ${row.target}${extra}`;
  };
  return `${r.rows.map(line).join('\n')}\n${r.summary}`;
}
