import type { TurnData } from '../../lib.ts';

// One conversation turn (ported from renderTurn). XSS-critical: every
// model/tool-derived string goes through text nodes (h() uses createTextNode
// for string children — the textContent path), never raw HTML injection.
export function Turn({ t }: { t: TurnData }): Node {
  return (
    <div class={'turn ' + (t.role === 'user' ? 'user' : '')}>
      <div class="thead">{`${t.role}${t.model ? ' · ' + t.model : ''} · step ${t.step}`}</div>
      {t.text && <div class="txt">{t.text}</div>}
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
