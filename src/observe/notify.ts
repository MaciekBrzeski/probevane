import type { Alert } from './alerts.js';

// External alert notification (Slice 2). Pure: turn computed alerts into a
// Slack-compatible webhook payload, and dedup against what's already been sent so
// the daemon's interval doesn't re-post the same alert every tick. The daemon does
// the HTTP POST (I/O); these are the testable decisions.

/** Stable key for an alert (kind + the day it's about — message carries the date). */
export function alertKey(a: Alert): string {
  return `${a.kind}:${a.message}`;
}

/** Alerts not present in the already-sent set. */
export function newAlerts(current: Alert[], sent: Set<string>): Alert[] {
  return current.filter((a) => !sent.has(alertKey(a)));
}

/** Webhook body built by buildAlertPayload() — Slack block-kit shape, but any
 *  receiver that reads `text` works too. */
export interface SlackPayload {
  text: string;
  blocks: { type: string; text: { type: string; text: string } }[];
}

/** Slack-compatible payload (also fine for a generic webhook that reads `text`). */
export function buildAlertPayload(alerts: Alert[]): SlackPayload {
  const icon = (a: Alert) => (a.severity === 'error' ? '🔴' : '🟠');
  const text = `probevane: ${alerts.length} alert(s) — ${alerts.map((a) => a.kind).join(', ')}`;
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*probevane alerts (${alerts.length})*` } },
      ...alerts.map((a) => ({
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: `${icon(a)} *${a.kind}* — ${a.message}` },
      })),
    ],
  };
}
