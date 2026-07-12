import { esc, type RunRecord } from '../lib.ts';
import { RUN_COLUMNS } from '../../../util/theme.ts';

// One clickable row of the run-history table — cells from the shared RUN_COLUMNS
// schema (the terminal renders the same columns as aligned text).
export function RunRow({ r, onOpen }: { r: RunRecord; onOpen: (r: RunRecord) => void }): Node {
  return (
    <tr class="clickable" onClick={() => onOpen(r)}>
      {RUN_COLUMNS.map((c) =>
        c.id === 'status' ? (
          <td><span class={'tag ' + (r.accepted ? 'accepted' : esc(r.stopReason))}>{r.accepted ? 'accepted' : r.stopReason}</span></td>
        ) : (
          <td class={c.muted ? 'muted' : undefined}>{c.get(r)}</td>
        ),
      )}
    </tr>
  );
}
