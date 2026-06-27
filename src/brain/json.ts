// Shared strict JSON extraction (structured-output, dep-free). Models reply with
// JSON wrapped in prose / ```json fences; this pulls the first top-level value
// (object OR array), then a caller-supplied type guard decides if the shape is
// acceptable — malformed/partial/wrong-shape returns null cleanly instead of
// throwing or half-parsing. Replaces the ad-hoc slice+JSON.parse scattered across
// the claude-code / bridge / review parsers.

/** Slice the first balanced `{…}` or `[…]` (string-aware) from `text`, or null. */
function sliceBalanced(text: string): string | null {
  let start = -1;
  let open = '{';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      start = i;
      open = text[i];
      break;
    }
  }
  if (start < 0) return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** The first JSON value in `text` (```json fence preferred, else balanced slice). */
export function extractJsonValue(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([[{][\s\S]*?[\]}])\s*```/);
  const candidate = fenced ? fenced[1] : sliceBalanced(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** Extract + validate against a type guard; null on absent / malformed / wrong-shape. */
export function extractJsonStrict<T>(text: string, validate: (x: unknown) => x is T): T | null {
  const v = extractJsonValue(text);
  return v !== null && validate(v) ? v : null;
}
