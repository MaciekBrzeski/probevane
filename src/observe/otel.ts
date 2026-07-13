import { summarize, type RunRecord } from '../cost/ledger.js';

// OpenTelemetry / Prometheus export (dep-free). The cost ledger already records
// per-run model/tokens/cost/accept/stop; this maps it to OTel-semantic data
// (gen_ai.* conventions) as OTLP/JSON — spans (one per run) + metrics — and to
// Prometheus text. No @opentelemetry/* dependency: emit the OTLP JSON shape a
// collector accepts on /v1/traces and /v1/metrics. Pure — the CLI/daemon do I/O.

// --- typed attribute values (OTLP wire shape) -----------------------------
type AttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };
/** Wrap a JS primitive in the OTLP AnyValue wire shape (ints as strings, per spec). */
function av(v: string | number | boolean): AttrValue {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
const attr = (key: string, v: string | number | boolean) => ({ key, value: av(v) });

/** Deterministic hex id of `len` chars from a string (stable re-export; not crypto). */
function hashHex(s: string, len: number): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let hex = '';
  while (hex.length < len)
    hex +=
      (h >>> 0).toString(16).padStart(8, '0') +
      (h = Math.imul(h ^ hex.length, 16777619) >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, len);
}

/** ISO timestamp → unix-nanos string (BigInt-safe). */
export function nanos(ts: string): string {
  return String(BigInt(Date.parse(ts) || 0) * 1_000_000n);
}

const RESOURCE = { attributes: [attr('service.name', 'probevane')] };

/** OTLP traces payload: one span per run, gen_ai.* + probevane.* attributes. */
export function tracesPayload(records: RunRecord[]) {
  const spans = records.map((r) => {
    const t = nanos(r.ts);
    return {
      traceId: hashHex(r.runId, 32),
      spanId: hashHex(r.runId + ':s', 16),
      name: r.label || 'probevane.run',
      kind: 1, // INTERNAL
      startTimeUnixNano: t,
      // Real span width when the run recorded a duration; zero-width for
      // ledger lines that predate the durationMs field.
      endTimeUnixNano: String(BigInt(t) + BigInt(Math.max(0, Math.round(r.durationMs ?? 0))) * 1_000_000n),
      attributes: [
        attr('gen_ai.system', 'anthropic'),
        attr('gen_ai.request.model', r.model),
        attr('gen_ai.usage.input_tokens', r.tokensIn),
        attr('gen_ai.usage.output_tokens', r.tokensOut),
        attr('gen_ai.usage.cache_read_tokens', r.cacheRead),
        attr('probevane.accepted', r.accepted),
        attr('probevane.took_over', r.tookOver),
        attr('probevane.stop_reason', r.stopReason),
        attr('probevane.steps', r.steps),
        attr('probevane.cost_usd', r.cost),
      ],
      status: { code: r.accepted ? 1 : 2 }, // OK : ERROR
    };
  });
  return { resourceSpans: [{ resource: RESOURCE, scopeSpans: [{ scope: { name: 'probevane' }, spans }] }] };
}

const sum = (name: string, unit: string, mono: boolean, dataPoints: unknown[]) => ({
  name,
  unit,
  sum: { aggregationTemporality: 2, isMonotonic: mono, dataPoints }, // 2 = CUMULATIVE
});
const gauge = (name: string, dataPoints: unknown[]) => ({ name, gauge: { dataPoints } });

/** OTLP metrics payload: token usage (by type), runs, acceptance rate, cost. */
export function metricsPayload(records: RunRecord[], now: string) {
  const s = summarize(records);
  const t = nanos(now);
  const tokenDP = (type: string, val: number) => ({
    asInt: String(val),
    timeUnixNano: t,
    attributes: [attr('gen_ai.token.type', type)],
  });
  const modelCostDP = Object.entries(s.byModel).map(([m, v]) => ({
    asDouble: v.cost,
    timeUnixNano: t,
    attributes: [attr('gen_ai.request.model', m)],
  }));
  const metrics = [
    sum('gen_ai.client.token.usage', '{token}', true, [
      tokenDP('input', s.totalTokensIn),
      tokenDP('output', s.totalTokensOut),
    ]),
    sum('probevane.runs', '{run}', true, [{ asInt: String(s.runs), timeUnixNano: t }]),
    sum('probevane.accepted', '{run}', true, [{ asInt: String(s.accepted), timeUnixNano: t }]),
    gauge('probevane.acceptance_rate', [{ asDouble: s.acceptRate, timeUnixNano: t }]),
    sum('probevane.cost_usd', 'USD', true, [{ asDouble: s.totalCost, timeUnixNano: t }, ...modelCostDP]),
  ];
  return { resourceMetrics: [{ resource: RESOURCE, scopeMetrics: [{ scope: { name: 'probevane' }, metrics }] }] };
}

/** Prometheus text-exposition of the same headline numbers (scrape-friendly). */
export function prometheusText(records: RunRecord[]): string {
  const s = summarize(records);
  const lines = [
    '# HELP probevane_runs_total Total probevane runs',
    '# TYPE probevane_runs_total counter',
    `probevane_runs_total ${s.runs}`,
    '# HELP probevane_accepted_total Accepted runs',
    '# TYPE probevane_accepted_total counter',
    `probevane_accepted_total ${s.accepted}`,
    '# HELP probevane_acceptance_rate Acceptance rate 0..1',
    '# TYPE probevane_acceptance_rate gauge',
    `probevane_acceptance_rate ${s.acceptRate}`,
    '# HELP probevane_tokens_total Token usage by type',
    '# TYPE probevane_tokens_total counter',
    `probevane_tokens_total{type="input"} ${s.totalTokensIn}`,
    `probevane_tokens_total{type="output"} ${s.totalTokensOut}`,
    '# HELP probevane_cost_usd_total Total cost (USD)',
    '# TYPE probevane_cost_usd_total counter',
    `probevane_cost_usd_total ${s.totalCost}`,
    ...Object.entries(s.byModel).map(([m, v]) => `probevane_cost_usd_total{model="${m}"} ${v.cost}`),
  ];
  return lines.join('\n') + '\n';
}
