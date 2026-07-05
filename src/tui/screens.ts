// Per-tab screen composition for the TUI — pure functions that lay out + paint
// a whole tab body into a Screen. The Console layout is derived from the shared
// theme manifest (CONSOLE_PANES) via spanToBox, the SAME regions the browser
// grid uses — one layout spec, two renderers. Row 0 is the tab bar, row h-1 the
// footer; the body is rows 1..h-2.

import { type Screen } from './screen.js';
import {
  costPane, pipelinePane, jobsPane, alertsPane, gaugePane, telemetryPane, constellationPane,
  type Rect, type Snapshot,
} from './views.js';
import { projectsPane, listPane, menuPane, textPane } from './panes.js';
import { LAYOUTS, spanToBox } from '../ui/theme.js';
import { FG } from './draw.js';
import type { PipelineState } from '../observe/pipeline.js';

export interface Anim { t: number; reveal: number }
/** Interactive tab state owned by the driver (docs selection/body, quality scan text). */
export interface Ui { docsSel: number; docsBody: string; quality: string }

const LAUNCH_HELP = [
  'press  l  to launch a command', '',
  'op  dir  --flags', '',
  'a probevane op (generate / feature / repair / …)',
  '  → daemon (POST /run) — appears in Runs with a live light-show',
  'anything else (claude, aider, another harness)',
  '  → your shell; the TUI suspends until it exits',
];
const TERMINAL_HELP = [
  'press  s  to drop to your shell', '',
  'runs $SHELL (claude / aider / any agentic harness)',
  'the TUI suspends; it resumes when the child exits', '',
  'the browser Terminal tab embeds xterm over a pty —',
  'here the real terminal IS your terminal.',
];

const bodyTop = 1;
const bodyH = (h: number) => Math.max(1, h - 2);

/** Every tab's cell rects, keyed by pane id — one manifest-driven pass (spanToBox) for all tabs. */
export function layoutFor(tab: string, w: number, h: number): Record<string, Rect> {
  const area = { x: 0, y: bodyTop, w, h: bodyH(h) };
  const out: Record<string, Rect> = {};
  for (const p of LAYOUTS[tab] ?? []) out[p.id] = spanToBox(p.span, area);
  return out;
}

export function paintConsole(scr: Screen, w: number, h: number, s: Snapshot, pipe: PipelineState, a: Anim, focus = 0): void {
  const L = layoutFor('console', w, h);
  pipelinePane(scr, L.pipeline, s.runes, pipe, a.t);
  telemetryPane(scr, L.telemetry, s.totals, s.daily, a);
  constellationPane(scr, L.constellation, s.hubs, a.t, focus);
}

/** Runs body — `sel` marks the highlighted run row. */
export function paintRuns(scr: Screen, w: number, h: number, s: Snapshot, sel: number): void {
  const L = layoutFor('runs', w, h);
  const runs = s.runs.map((r, i) => ({ ...r, label: (i === sel ? '▸ ' : '  ') + (r.label ?? r.runId) }));
  jobsPane(scr, L.jobs, s.jobs, runs);
  alertsPane(scr, L.alerts, s.alerts);
}

export function paintCost(scr: Screen, w: number, h: number, s: Snapshot, a: Anim): void {
  const L = layoutFor('cost', w, h);
  costPane(scr, L.cost, s.daily);
  alertsPane(scr, L.alerts, s.alerts);
  gaugePane(scr, L.telemetry, s.totals, a);
}

export function paintProjects(scr: Screen, w: number, h: number, s: Snapshot): void {
  projectsPane(scr, layoutFor('projects', w, h).projects, s.projects);
}

/** Docs: wiki page list (left, `ui.docsSel`) + the selected page body (right). */
export function paintDocs(scr: Screen, w: number, h: number, s: Snapshot, ui: Ui): void {
  const L = layoutFor('docs', w, h);
  listPane(scr, L.pages, 'docs', FG.acc, s.wikiPages, ui.docsSel);
  textPane(scr, L.page, 'page', FG.acc, ui.docsBody ? ui.docsBody.split('\n') : ['↑↓ select a page']);
}

export function paintLaunch(scr: Screen, w: number, h: number, s: Snapshot): void {
  const L = layoutFor('launch', w, h);
  menuPane(scr, L.ops, 'operations', s.ops);
  textPane(scr, L.launchHint, 'launch', FG.acc, LAUNCH_HELP);
}

export function paintQuality(scr: Screen, w: number, h: number, ui: Ui): void {
  textPane(scr, layoutFor('quality', w, h).quality, 'quality', FG.ok, ui.quality ? ui.quality.split('\n') : ['scanning…']);
}

export function paintTerminal(scr: Screen, w: number, h: number): void {
  textPane(scr, layoutFor('terminal', w, h).terminal, 'terminal', FG.acc, TERMINAL_HELP);
}
