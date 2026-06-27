import { describe, it, expect } from 'vitest';
import { reduceQueue, nextReady, newItem, mark, queueSummary, type QueueItem } from '../src/observe/queue.js';

const it0 = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'a',
  op: 'generate',
  dir: '/x',
  flags: [],
  status: 'queued',
  attempts: 0,
  enqueuedAt: '2026-06-27T10:00:00Z',
  nextAt: 0,
  ...over,
});

describe('reduceQueue', () => {
  it('keeps the last write per id', () => {
    const rows = [it0({ id: 'a', status: 'queued' }), it0({ id: 'a', status: 'done' }), it0({ id: 'b' })];
    const out = reduceQueue(rows);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.id === 'a')?.status).toBe('done');
  });
});

describe('nextReady', () => {
  it('picks the oldest queued item whose backoff elapsed', () => {
    const items = [
      it0({ id: 'new', enqueuedAt: '2026-06-27T12:00:00Z' }),
      it0({ id: 'old', enqueuedAt: '2026-06-27T09:00:00Z' }),
    ];
    expect(nextReady(items, 1)?.id).toBe('old');
  });
  it('skips running/done and not-yet-ready (backoff) items', () => {
    const now = 1000;
    expect(nextReady([it0({ status: 'running' }), it0({ id: 'd', status: 'done' })], now)).toBeNull();
    expect(nextReady([it0({ nextAt: now + 5000 })], now)).toBeNull();
    expect(nextReady([it0({ nextAt: now - 1 })], now)?.id).toBe('a');
  });
  it('null on empty', () => {
    expect(nextReady([], 1)).toBeNull();
  });
});

describe('mark', () => {
  it('bumps attempts on running, stamps end/exit on finish, is immutable', () => {
    const a = it0();
    const running = mark(a, 'running');
    expect(running.attempts).toBe(1);
    expect(a.attempts).toBe(0); // original untouched
    const done = mark(running, 'done', { exitCode: 0, endedAt: 't' });
    expect(done.status).toBe('done');
    expect(done.exitCode).toBe(0);
    expect(done.attempts).toBe(1); // not bumped on non-running transition
  });
  it('carries a backoff nextAt', () => {
    expect(mark(it0(), 'queued', { nextAt: 5000 }).nextAt).toBe(5000);
  });
});

describe('newItem + queueSummary', () => {
  it('newItem starts queued, zero attempts, no backoff', () => {
    const i = newItem('id1', 'refactor', '/d', ['--quality'], 'ts');
    expect(i).toMatchObject({ id: 'id1', op: 'refactor', status: 'queued', attempts: 0, nextAt: 0, flags: ['--quality'] });
  });
  it('queueSummary counts by status', () => {
    expect(queueSummary([it0(), it0({ id: 'b', status: 'running' }), it0({ id: 'c', status: 'done' })])).toEqual({ queued: 1, running: 1, done: 1, error: 0 });
  });
});
