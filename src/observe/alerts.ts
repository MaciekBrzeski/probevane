import type { DailyBucket } from './aggregate.js';

// Alerting core (Phase 4). Pure: read the per-day time series and emit alerts the
// daemon surfaces — a cost spike vs the trailing average, an acceptance-rate drop
// vs the trailing rate, and a burst of error stops. Thresholds have defaults and
// are overridable (env-wired by the daemon). No I/O.

export type AlertKind = 'cost_spike' | 'acceptance_drop' | 'error_burst';

/** One fired alert — computed by computeAlerts() from the daily series; the
 *  daemon surfaces it (dashboard, webhook, halt decision). */
export interface Alert {
  kind: AlertKind;
  severity: 'warn' | 'error';
  message: string;
  value: number;
  threshold: number;
}

/** Alert thresholds — DEFAULT_ALERT_OPTS fills them; the daemon overrides from env. */
export interface AlertOpts {
  /** Latest-day cost > spikeFactor × trailing-window avg fires a spike. */
  spikeFactor: number;
  /** Days of history the trailing average/rate look back over (excludes latest). */
  window: number;
  /** Acceptance drop: latest rate < trailing rate − dropDelta fires. */
  dropDelta: number;
  /** Need at least this many runs on each side to judge an acceptance drop. */
  minRuns: number;
  /** Error stops in the latest day ≥ this fires a burst. */
  errorBurst: number;
}

export const DEFAULT_ALERT_OPTS: AlertOpts = {
  spikeFactor: 3,
  window: 7,
  dropDelta: 0.2,
  minRuns: 5,
  errorBurst: 3,
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Cost spike — latest day vs trailing average (needs prior spend to compare to). */
function costSpikeAlert(latest: DailyBucket, trailing: DailyBucket[], o: AlertOpts): Alert | null {
  if (!trailing.length) return null;
  const avg = trailing.reduce((a, b) => a + b.cost, 0) / trailing.length;
  if (!(avg > 0 && latest.cost > o.spikeFactor * avg)) return null;
  return {
    kind: 'cost_spike',
    severity: 'warn',
    message: `cost on ${latest.date} ($${round(latest.cost)}) is ${round(latest.cost / avg)}× the ${trailing.length}-day avg ($${round(avg)})`,
    value: round(latest.cost),
    threshold: round(o.spikeFactor * avg),
  };
}

/** Acceptance drop — latest rate vs trailing rate (both need enough runs to mean anything). */
function acceptanceDropAlert(latest: DailyBucket, trailing: DailyBucket[], o: AlertOpts): Alert | null {
  if (!trailing.length) return null;
  const tRuns = trailing.reduce((a, b) => a + b.runs, 0);
  const tAcc = trailing.reduce((a, b) => a + b.accepted, 0);
  if (!(latest.runs >= o.minRuns && tRuns >= o.minRuns)) return null;
  const trailingRate = tAcc / tRuns;
  if (!(latest.acceptRate < trailingRate - o.dropDelta)) return null;
  return {
    kind: 'acceptance_drop',
    severity: 'error',
    message: `acceptance on ${latest.date} (${round(latest.acceptRate)}) dropped from the ${trailing.length}-day rate (${round(trailingRate)})`,
    value: round(latest.acceptRate),
    threshold: round(trailingRate - o.dropDelta),
  };
}

/** Error burst — error stops in the latest day. */
function errorBurstAlert(latest: DailyBucket, o: AlertOpts): Alert | null {
  if (!(latest.errors >= o.errorBurst)) return null;
  return {
    kind: 'error_burst',
    severity: 'error',
    message: `${latest.errors} error stop(s) on ${latest.date} (threshold ${o.errorBurst})`,
    value: latest.errors,
    threshold: o.errorBurst,
  };
}

/** Compute alerts from the ascending daily series. Empty/insufficient → []. */
export function computeAlerts(daily: DailyBucket[], opts: Partial<AlertOpts> = {}): Alert[] {
  const o = { ...DEFAULT_ALERT_OPTS, ...opts };
  if (daily.length === 0) return [];

  const latest = daily[daily.length - 1];
  const trailing = daily.slice(Math.max(0, daily.length - 1 - o.window), daily.length - 1);

  const alerts: Alert[] = [];
  for (const a of [
    costSpikeAlert(latest, trailing, o),
    acceptanceDropAlert(latest, trailing, o),
    errorBurstAlert(latest, o),
  ]) {
    if (a) alerts.push(a);
  }
  return alerts;
}

/** Circuit-breaker: should the line halt? True on any error-severity alert. */
export function shouldHalt(alerts: Alert[]): boolean {
  return alerts.some((a) => a.severity === 'error');
}
