import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { readRuns } from '../cost/ledger.js';
import { statePath } from '../util/state.js';
import { tracesPayload, metricsPayload, prometheusText } from '../observe/otel.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane otel` backend — export the cost ledger as OpenTelemetry data
// (dep-free OTLP/JSON: gen_ai.* spans + metrics): write to a file, POST to a
// collector (--endpoint / OTEL_EXPORTER_OTLP_ENDPOINT), or emit Prometheus
// text (--prometheus). Reads existing runs.jsonl ($0, no LLM). Logic moved
// verbatim from the old src/cli/otel.ts shell; the vane interpreter owns argv.

/** Read the ledger (default state or --root) and emit Prometheus / POST OTLP / write JSON. */
export async function run(ctx: CommandCtx): Promise<void> {
  const root = ctx.flags.root as string | undefined;
  const ledger = root ? join(resolve(root), 'runs.jsonl') : statePath('runs.jsonl');
  const records = await readRuns(ledger).catch(() => []);
  if (!records.length) {
    console.error(`[probevane] otel: no runs in ${ledger}`);
    return;
  }
  const now = new Date().toISOString();

  if (ctx.flags.prometheus === true) {
    const text = prometheusText(records);
    const out = ctx.flags.out as string | undefined;
    if (out) await writeFile(resolve(out), text);
    else process.stdout.write(text);
    return;
  }

  const traces = tracesPayload(records);
  const metrics = metricsPayload(records, now);

  const endpoint = (ctx.flags.endpoint as string | undefined) ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint) {
    const base = endpoint.replace(/\/$/, '');
    for (const [path, body] of [['/v1/traces', traces], ['/v1/metrics', metrics]] as const) {
      const r = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch((e) => ({ ok: false, status: String(e?.message ?? e) }) as any);
      console.error(`[probevane] otel POST ${base}${path} → ${r.ok ? 'ok' : 'FAILED ' + (r.status ?? '')}`);
    }
    return;
  }

  const payload = { traces, metrics };
  const out = ctx.flags.out as string | undefined;
  if (out) {
    await writeFile(resolve(out), JSON.stringify(payload, null, 2));
    console.error(`[probevane] otel: wrote ${records.length} run(s) → ${resolve(out)}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}
