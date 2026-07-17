import type { TurnData } from '../../lib.ts';

/** A turn's text is "long" (worth clamping) if it's many lines or many chars —
 *  e.g. the injected step-0 task prompt (GROUND TRUTH + mock plan). */
function isLong(text: string): boolean {
  return text.length > 400 || text.split('\n').length > 6;
}

/** Render turn text; clamp long text to a few lines with a show-more toggle so a
 *  mega-prompt (or long chain-of-thought) doesn't wall the conversation. */
function textBlock(text: string): Node {
  if (!isLong(text)) return <div class="txt">{text}</div>;
  const box = <div class="txt clamp">{text}</div> as HTMLElement;
  const btn = <button class="txt-toggle" type="button">show more</button> as HTMLButtonElement;
  btn.onclick = () => { btn.textContent = box.classList.toggle('clamp') ? 'show more' : 'show less'; };
  return <div class="txt-wrap">{box}{btn}</div>;
}

// One conversation turn (ported from renderTurn). XSS-critical: every
// model/tool-derived string goes through text nodes (h() uses createTextNode
// for string children — the textContent path), never raw HTML injection.
export function Turn({ t }: { t: TurnData }): Node {
  return (
    <div class={'turn ' + (t.role === 'user' ? 'user' : '')}>
      <div class="thead">{`${t.role}${t.model ? ' · ' + t.model : ''} · step ${t.step}`}</div>
      {t.text ? textBlock(t.text) : null}
      {(t.toolCalls || []).map((c) => (
        <details>
          <summary>{'→ ' + c.name}</summary>
          <pre>{typeof c.input === 'string' ? c.input : JSON.stringify(c.input, null, 2)}</pre>
        </details>
      ))}
      {(t.toolResults || []).map((r) => (
        <details class={r.ok ? 'ok' : 'err'}>
          <summary>{(r.ok ? '✓ ' : '✗ ') + r.name}</summary>
          <pre>{r.content}</pre>
        </details>
      ))}
    </div>
  );
}
