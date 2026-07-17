import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { parseEvents } from '../loop/events.js';
import { statePath } from '../util/state.js';
import type { RouteCtx } from './daemon-routes.js';

// Console-tab data routes, split out of daemon-routes to keep both files small and
// each route a small function. A runId is safe to interpolate into a path only with
// no separators/traversal — defense in depth atop the 127.0.0.1 binding.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/** GET /pipeline — the rune pipeline for the console graph, derived live from the
 *  real profiles (never a stale committed model). */
async function pipelineRoute(query: URLSearchParams, res: ServerResponse, ctx: RouteCtx): Promise<void> {
  const { describePipeline } = await import('../loop/describe.js');
  const profile = (query.get('profile') ?? 'write_tests') as Parameters<typeof describePipeline>[0];
  try {
    ctx.sendJson(res, 200, describePipeline(profile, { kind: 'unit' }));
  } catch {
    ctx.sendJson(res, 400, { error: `unknown profile ${String(profile)}` });
  }
}

/** GET /events — a run's durable event stream from the state root (survives workdir
 *  deletion — the whole point), for theater replay. */
async function eventsRoute(query: URLSearchParams, res: ServerResponse, ctx: RouteCtx): Promise<void> {
  const runId = query.get('runId');
  if (!runId || !SAFE_ID.test(runId)) { ctx.sendJson(res, 400, { error: 'valid runId required' }); return; }
  const txt =
    (await readFile(statePath('events', `${runId}.jsonl`), 'utf8').catch(() => null)) ??
    (await readFile(join(ctx.ROOT, 'events', `${runId}.jsonl`), 'utf8').catch(() => null));
  if (txt === null) { ctx.sendJson(res, 404, { error: 'no captured events for this run' }); return; }
  ctx.sendJson(res, 200, { runId, events: parseEvents(txt) });
}

/** GET /graph — the module constellation: dependency graph + fan-in per node. */
async function graphRoute(query: URLSearchParams, res: ServerResponse, ctx: RouteCtx): Promise<void> {
  const dir = query.get('dir') ?? process.env.PROBEVANE_ROOT ?? '.';
  const { buildGraph } = await import('../mock/graph.js');
  const g = await buildGraph(resolve(dir));
  const fanIn = new Map<string, number>();
  for (const n of g.nodes.values()) for (const dep of n.imports) fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
  const nodes = [...g.nodes.values()].map((n) => ({ ...n, fanIn: fanIn.get(n.path) ?? 0 }));
  ctx.sendJson(res, 200, { nodes, order: g.order });
}

/** Console-tab data: rune pipeline + theater events + module constellation. Returns
 *  true if it handled `url`. */
export async function handleConsoleData(
  url: string, query: URLSearchParams, res: ServerResponse, ctx: RouteCtx,
): Promise<boolean> {
  if (url === '/pipeline') { await pipelineRoute(query, res, ctx); return true; }
  if (url === '/events') { await eventsRoute(query, res, ctx); return true; }
  if (url === '/graph') { await graphRoute(query, res, ctx); return true; }
  return false;
}
