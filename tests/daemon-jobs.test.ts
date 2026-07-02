import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduceJobs, jobsToEvict, type PersistedJob } from '../src/observe/jobs.js';

const job = (over: Partial<PersistedJob> = {}): PersistedJob => ({
  id: 'a',
  op: 'quality',
  dir: '/x',
  flags: [],
  status: 'done',
  startedAt: '2026-06-27T00:00:00Z',
  tail: [],
  ...over,
});

describe('reduceJobs', () => {
  it('keeps the last write per id', () => {
    const rows = [
      job({ id: 'a', status: 'running' }),
      job({ id: 'a', status: 'done', exitCode: 0 }),
      job({ id: 'b', status: 'error', exitCode: 1 }),
    ];
    const out = reduceJobs(rows);
    expect(out).toHaveLength(2);
    expect(out.find((j) => j.id === 'a')?.status).toBe('done');
  });

  it("marks an orphaned 'running' job as error", () => {
    const out = reduceJobs([job({ id: 'a', status: 'running' })]);
    expect(out[0].status).toBe('error');
    expect(out[0].exitCode).toBe(-1);
  });

  it('leaves finished jobs untouched', () => {
    const out = reduceJobs([job({ id: 'a', status: 'done', exitCode: 0 })]);
    expect(out[0].status).toBe('done');
    expect(out[0].exitCode).toBe(0);
  });
});

describe('jobsToEvict', () => {
  it('returns [] within budget', () => {
    expect(jobsToEvict([job({ id: 'a' }), job({ id: 'b' })], 5)).toEqual([]);
  });

  it('evicts the oldest finished jobs past the cap', () => {
    const jobs = [
      job({ id: 'old', status: 'done', startedAt: '2026-01-01T00:00:00Z' }),
      job({ id: 'mid', status: 'error', startedAt: '2026-02-01T00:00:00Z' }),
      job({ id: 'new', status: 'done', startedAt: '2026-03-01T00:00:00Z' }),
    ];
    expect(jobsToEvict(jobs, 2)).toEqual(['old']);
  });

  it('never evicts a running job even when over cap', () => {
    const jobs = [
      job({ id: 'r1', status: 'running', startedAt: '2026-01-01T00:00:00Z' }),
      job({ id: 'r2', status: 'running', startedAt: '2026-02-01T00:00:00Z' }),
    ];
    expect(jobsToEvict(jobs, 1)).toEqual([]); // nothing finished to drop
  });
});

describe('control center XSS guard (asset)', () => {
  const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'control.html'),
    'utf8',
  );
  it('defines an esc() escaper + textContent el() helper', () => {
    expect(html).toMatch(/const esc =/);
    expect(html).toContain('&lt;');
    // The control center builds DOM via a createElement/textContent helper.
    expect(html).toMatch(/const el = \(tag/);
  });
  it('renders the transcript via textContent, never innerHTML', () => {
    // renderTurn is the highest XSS surface (arbitrary model output + file
    // contents). It must build nodes with el()/textContent, not innerHTML.
    expect(html).toMatch(/function renderTurn/);
    const fn = html.slice(html.indexOf('function renderTurn'), html.indexOf('function renderTurn') + 900);
    expect(fn).not.toMatch(/innerHTML/);
    expect(fn).toMatch(/el\('pre', null, r\.content\)/); // tool result body as text
  });
  it('renders wiki markdown only with mermaid securityLevel strict', () => {
    expect(html).toMatch(/securityLevel:\s*'strict'/);
  });
  it('has the control-center tabs', () => {
    for (const t of ['projects', 'runs', 'docs', 'launch']) expect(html).toContain(`data-go="${t}"`);
  });
});
