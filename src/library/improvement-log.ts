import { appendFile, readFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';

// Append-only improvement log — fourier-nca discipline. Never rewritten.
// Columns mirror qaforge's improvement-log.csv plus coverage + flake.

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
] as const;

export type LogRow = Partial<Record<(typeof LOG_COLUMNS)[number], string | number>>;

export async function appendLog(logPath: string, row: LogRow): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const exists = await access(logPath).then(() => true).catch(() => false);
  let out = '';
  if (!exists) out += LOG_COLUMNS.join(',') + '\n';
  out += LOG_COLUMNS.map((c) => csv(row[c])).join(',') + '\n';
  await appendFile(logPath, out);
}

export async function readLog(logPath: string): Promise<Record<string, string>[]> {
  const txt = await readFile(logPath, 'utf8').catch(() => '');
  if (!txt.trim()) return [];
  const [header, ...lines] = txt.trim().split('\n');
  const cols = header.split(',');
  return lines.map((l) => {
    const cells = l.split(',');
    const o: Record<string, string> = {};
    cols.forEach((c, i) => (o[c] = cells[i] ?? ''));
    return o;
  });
}

function csv(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
