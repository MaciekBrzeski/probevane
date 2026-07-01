import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildGraph } from '../mock/graph.js';
import { toFolderTree, toAscii, graphSummary, sharedModules } from '../mock/render.js';
import { archMetrics, archDigest } from './metrics.js';

// Experimental architecture-critique loop: build the module graph, render the
// FOLDER tree + DEPENDENCY tree + coupling metrics, and ask an LLM what could be
// structurally better (misplaced modules, over-coupled dirs, split candidates,
// layering issues, cycles). Report-only — it never edits; it surfaces findings.
//
// Text model ($0 ollama): PROBEVANE_ARCH_BASE (default ollama cloud) +
// PROBEVANE_ARCH_MODEL (default glm-5.2), key from PROBEVANE_ARCH_KEY /
// PROBEVANE_API_KEY / the ollama key file.

const ARCH_BASE = process.env.PROBEVANE_ARCH_BASE ?? 'https://ollama.com/v1';
const ARCH_MODEL = process.env.PROBEVANE_ARCH_MODEL ?? 'glm-5.2';

function archKey(): string {
  const env = process.env.PROBEVANE_ARCH_KEY ?? process.env.PROBEVANE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (env) return env;
  const file = process.env.PROBEVANE_OLLAMA_KEY_FILE ?? join(homedir(), '.config', 'probevane', 'ollama.key');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`arch: no API key — set PROBEVANE_ARCH_KEY or create ${file}`);
  }
}

const SYSTEM =
  'You are a pragmatic software architect. You are given a project\'s on-disk FOLDER tree, its ' +
  'module DEPENDENCY summary, the list of shared hub modules, and directory COUPLING metrics. ' +
  'Identify the 5-8 most impactful, CONCRETE structural improvements: modules that live in the ' +
  'wrong directory (coupled elsewhere), directories that should be split or merged, over-coupled ' +
  'dir pairs, layering violations, and cycles. For each: what + why + a specific suggested move. ' +
  'Be terse and specific. Do NOT praise; only surface what to improve. If the structure is sound, say so.';

async function llmCritique(prompt: string): Promise<string> {
  const res = await fetch(`${ARCH_BASE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${archKey()}` },
    body: JSON.stringify({
      model: ARCH_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`arch ${res.status} ${await res.text().catch(() => '')}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[] };
  const m = j.choices?.[0]?.message;
  return m?.content || m?.reasoning || '';
}

export interface ArchReport {
  model: string;
  folderTree: string;
  depSummary: string;
  digest: string;
  hubs: { path: string; importedBy: number }[];
  findings: string;
}

/** Assemble the architecture prompt from a graph's renders + metrics. */
export function archPrompt(folderTree: string, depTree: string, summary: string, digest: string): string {
  return [
    `Dependency summary: ${summary}`,
    '', '# Folder structure (on disk)', '```', folderTree, '```',
    '', '# Directory metrics', digest,
    '', '# Dependency tree (imports; ⇗ shared = hub, listed in the footer)', '```', depTree, '```',
    '', 'What could be structurally better? Give concrete, actionable findings.',
  ].join('\n');
}

export async function archCritique(dir: string, opts: { llm?: boolean } = {}): Promise<ArchReport> {
  const graph = await buildGraph(dir);
  const paths = [...graph.nodes.keys()];
  const folderTree = toFolderTree(paths);
  const depTree = toAscii(graph, graph.nodes.size > 40 ? { collapseHubs: 8 } : undefined);
  const summary = graphSummary(graph);
  const metrics = archMetrics(graph);
  const digest = archDigest(metrics);
  const hubs = sharedModules(graph, 8);
  const findings = opts.llm === false ? '' : await llmCritique(archPrompt(folderTree, depTree, summary, digest));
  return { model: ARCH_MODEL, folderTree, depSummary: summary, digest, hubs, findings };
}
