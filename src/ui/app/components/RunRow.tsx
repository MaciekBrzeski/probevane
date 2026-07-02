import { esc, type RunRecord } from '../lib.ts';

// One clickable row of the run-history table (ported from the loadRuns loop body).
export function RunRow({ r, onOpen }: { r: RunRecord; onOpen: (r: RunRecord) => void }): Node {
  return (
    <tr class="clickable" onClick={() => onOpen(r)}>
      <td class="muted">{(r.ts || '').slice(0, 19).replace('T', ' ')}</td>
      <td>{r.label || ''}</td>
      <td class="muted">{r.model || ''}</td>
      <td><span class={'tag ' + (r.accepted ? 'accepted' : esc(r.stopReason))}>{r.accepted ? 'accepted' : r.stopReason}</span></td>
      <td class="muted">{'$' + (r.cost ?? 0)}</td>
      <td class="muted">{String(r.steps ?? '')}</td>
    </tr>
  );
}
