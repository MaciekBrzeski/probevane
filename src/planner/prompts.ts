// Prompt shapes for the feature planner — the FIM (prefix/suffix) framing, the chat
// framing, and the shared step parser. Kept pure + separate so the planner logic and
// the prompt wording are independently testable.

/** The FIM PREFIX: current state + the start of a numbered step list. The model
 *  infills the middle (the steps) up to the suffix. Seeds "1. " so the first token
 *  the model produces is step one's content. */
export function fimPrefix(from: string): string {
  return `# Feature implementation plan

## Current state
${from.trim()}

## Steps to get from the current state to the desired state
1. `;
}

/** The FIM SUFFIX: the desired end state the infilled steps must arrive at. */
export function fimSuffix(to: string): string {
  return `

## Desired state (reached once every step above is done)
${to.trim()}
`;
}

export const CHAT_SYSTEM =
  'You are a senior software engineer writing an implementation plan. Given the CURRENT ' +
  'state and the DESIRED state, output the concrete, ordered steps BETWEEN them — the work ' +
  'that turns current into desired. Rules: number each step ("1.", "2.", …); one action per ' +
  'step; start each with a short imperative title, then specifics (files, functions, checks) ' +
  'on the same or following lines; be detailed and self-contained; no preamble, no summary, ' +
  'no fluff — output the numbered list only.';

export function chatUser(from: string, to: string, steps?: number): string {
  const budget = steps ? `\nAim for about ${steps} steps.` : '';
  return `CURRENT STATE:\n${from.trim()}\n\nDESIRED STATE:\n${to.trim()}\n\nWrite the numbered implementation steps from current to desired.${budget}`;
}

export interface PlanStep {
  n: number;
  title: string;
  detail: string;
}

const STEP_RE = /^\s{0,3}(\d+)[.)]\s+(.*)$/;

/** Parse a numbered-list plan (from FIM middle or chat text) into ordered steps.
 *  A step runs from its "N." line until the next "N." line; the first line is the
 *  title, any following indented/continuation lines are folded into the detail. */
export function parseSteps(text: string): PlanStep[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const steps: PlanStep[] = [];
  let cur: PlanStep | null = null;
  const detailBuf: string[] = [];
  const flush = () => {
    if (cur) {
      cur.detail = detailBuf.join('\n').trim();
      steps.push(cur);
    }
    detailBuf.length = 0;
  };
  for (const line of lines) {
    const m = STEP_RE.exec(line);
    if (m) {
      flush();
      cur = { n: Number(m[1]), title: m[2]!.trim(), detail: '' };
    } else if (cur && line.trim()) {
      detailBuf.push(line.trim());
    }
  }
  flush();
  // Renumber sequentially (models sometimes restart or skip numbers).
  return steps.map((s, i) => ({ ...s, n: i + 1 }));
}
