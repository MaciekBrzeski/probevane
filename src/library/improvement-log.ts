import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Append-only improvement log — fourier-nca discipline. Never rewritten.
// Columns mirror qaforge's improvement-log.csv plus coverage + flake, then the
// correctness/cost era (mutation + tokens). Widening the schema appends a NEW
// header line mid-file instead of rewriting the old one; readLog switches its
// column mapping at each header line, so every era parses with its own schema.

export const LOG_COLUMNS = [
  'timestamp',
  'target',
  'kind',
  'pass',
  'audit_score',
  'tests',
  'coverage',
  'flake',
  'library_good',
  'library_bad',
  'note',
  'mutation',
  'cost_usd',
  'tokens_in',
  'tokens_out',
] as const;

export type LogRow = Partial<Record<(typeof LOG_COLUMNS)[number], string | number>>;

const HEADER = LOG_COLUMNS.join(',');

export async function appendLog(logPath: string, row: LogRow): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const txt = await readFile(logPath, 'utf8').catch(() => '');
  let out = '';
  // New file, or a file whose LAST header line is an older schema → append the
  // current header before the row (append-only: old lines are never touched).
  const lastHeader = txt
    .split('\n')
    .filter((l) => l.startsWith('timestamp,'))
    .pop();
  if (lastHeader !== HEADER) out += HEADER + '\n';
  out += LOG_COLUMNS.map((c) => csv(row[c])).join(',') + '\n';
  await appendFile(logPath, out);
}

export async function readLog(logPath: string): Promise<Record<string, string>[]> {
  const txt = await readFile(logPath, 'utf8').catch(() => '');
  if (!txt.trim()) return [];
  const rows: Record<string, string>[] = [];
  let cols: string[] = [];
  for (const l of txt.trim().split('\n')) {
    if (l.startsWith('timestamp,')) {
      cols = l.split(','); // a header line switches the active schema
      continue;
    }
    if (!cols.length) continue; // data before any header — unreadable, skip
    const cells = l.split(',');
    const o: Record<string, string> = {};
    cols.forEach((c, i) => (o[c] = cells[i] ?? ''));
    rows.push(o);
  }
  return rows;
}

function csv(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
