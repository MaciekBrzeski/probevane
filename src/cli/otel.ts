import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { readRuns } from '../cost/ledger.js';
import { statePath } from '../util/state.js';
import { tracesPayload, metricsPayload, prometheusText } from '../observe/otel.js';
import { flag } from './args.js';

// probevane otel [--root <stateDir>] [--out <file>] [--endpoint <otlp-url>] [--prometheus]
//
// Export the cost ledger as OpenTelemetry data (dep-free OTLP/JSON: gen_ai.*
// spans + metrics) — write to a file, POST to a collector, or emit Prometheus
// text. Reads existing runs.jsonl ($0, no LLM).

async function main() {
  const args = process.argv.slice(2);
  const root = flag(args, '--root');
  const ledger = root ? join(resolve(root), 'runs.jsonl') : statePath('runs.jsonl');
  const records = await readRuns(ledger).catch(() => []);
  if (!records.length) {
    console.error(`[probevane] otel: no runs in ${ledger}`);
    return;
  }
  const now = new Date().toISOString();

  if (args.includes('--prometheus')) {
    const text = prometheusText(records);
    const out = flag(args, '--out');
    if (out) await writeFile(resolve(out), text);
    else process.stdout.write(text);
    return;
  }

  const traces = tracesPayload(records);
  const metrics = metricsPayload(records, now);

  const endpoint = flag(args, '--endpoint') ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
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
  const out = flag(args, '--out');
  if (out) {
    await writeFile(resolve(out), JSON.stringify(payload, null, 2));
    console.error(`[probevane] otel: wrote ${records.length} run(s) → ${resolve(out)}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
