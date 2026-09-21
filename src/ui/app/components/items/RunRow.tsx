import { esc, type RunRecord } from '../../lib.ts';
import { RUN_COLUMNS } from '../../../../util/theme.ts';

// One clickable row of the run-history table — cells from the shared RUN_COLUMNS
// schema (the terminal renders the same columns as aligned text).
export function RunRow({ r, onOpen }: { r: RunRecord; onOpen: (r: RunRecord) => void }): Node {
  const tr = (
    <tr class="clickable anim-enter" onClick={() => onOpen(r)}>
      {RUN_COLUMNS.map((c) =>
        c.id === 'status' ? (
          <td><span class={'tag ' + (r.accepted ? 'accepted' : esc(r.stopReason))}>{r.accepted ? 'accepted' : r.stopReason}</span></td>
        ) : (
          <td class={c.muted ? 'muted' : undefined}>{c.get(r)}</td>
        ),
      )}
    </tr>
  ) as HTMLElement;
  // entrance plays once per NEW row (keyed reconcile never rebuilds unchanged
  // rows, so a poll refresh animates only genuinely new runs); class removed
  // after so a later reorder move doesn't replay it
  tr.addEventListener('animationend', () => tr.classList.remove('anim-enter'), { once: true });
  return tr;
}
