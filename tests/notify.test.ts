import { describe, it, expect } from 'vitest';
import { alertKey, newAlerts, buildAlertPayload } from '../src/observe/notify.js';
import type { Alert } from '../src/observe/alerts.js';

const a = (over: Partial<Alert> = {}): Alert => ({
  kind: 'cost_spike',
  severity: 'warn',
  message: 'cost on 2026-06-27 is 6× the avg',
  value: 6,
  threshold: 1,
  ...over,
});

describe('newAlerts dedup', () => {
  it('returns only alerts not already sent', () => {
    const cur = [a(), a({ kind: 'error_burst', severity: 'error', message: '4 errors' })];
    const sent = new Set([alertKey(cur[0])]);
    const fresh = newAlerts(cur, sent);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].kind).toBe('error_burst');
  });
  it('empty when all sent', () => {
    const cur = [a()];
    expect(newAlerts(cur, new Set([alertKey(cur[0])]))).toEqual([]);
  });
});

describe('buildAlertPayload', () => {
  it('is Slack-compatible (text + blocks) and names each alert', () => {
    const p = buildAlertPayload([a(), a({ kind: 'acceptance_drop', severity: 'error', message: 'rate fell' })]);
    expect(p.text).toContain('2 alert(s)');
    expect(p.text).toContain('cost_spike');
    expect(p.blocks.length).toBe(3); // header + 2 alerts
    expect(p.blocks[1].text.text).toContain('cost_spike');
    expect(p.blocks[2].text.text).toContain('acceptance_drop');
  });
});
