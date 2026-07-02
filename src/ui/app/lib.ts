// Non-component helpers for the control center — ported verbatim from the old
// inline script in control.html (which is now GENERATED from these sources).

export const $ = (id: string): HTMLElement => document.getElementById(id)!;

export const j = async (u: string, o?: RequestInit) => (await fetch(u, o)).json();

// Escape values interpolated into innerHTML. Transcript / model text is rendered
// via text nodes (see components/Turn.tsx) — never innerHTML — since it is
// arbitrary model output + file contents + repo paths (the largest attack surface).
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

// Run detail: dir inferred from label target.
export function dirOf(label?: string): string {
  const t = (label || '').split(':').slice(1).join(':');
  return t || '.';
}

// --- shared shapes (typed loosely: the daemon JSON is the source of truth) ---
export interface RunRecord {
  ts?: string;
  runId: string;
  label?: string;
  model?: string;
  accepted?: boolean;
  stopReason?: string;
  cost?: number;
  steps?: number;
}

export interface ProjectInfo {
  slug: string;
  name: string;
  runCount: number;
  acceptRate: number;
  lastRun?: { accepted?: boolean; stopReason?: string } | null;
}

export interface TurnData {
  role: string;
  model?: string;
  step?: number;
  text?: string;
  toolCalls?: { name: string; input?: unknown }[];
  toolResults?: { name: string; ok?: boolean; content?: string }[];
}
