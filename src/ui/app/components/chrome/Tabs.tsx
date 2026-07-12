// Tab strip — rendered from the shared theme SSOT (TABS). Click handling stays
// event-delegated on #tabs (wired in main.tsx). The terminal renders the same
// list, filtered to TERMINAL_TABS.
import { TABS } from '../../../../util/theme.ts';

export function Tabs(): Node {
  return (
    <nav class="tabs" id="tabs">
      {TABS.map((t, i) => (
        <button data-go={t.id} class={i === 0 ? 'active' : undefined}>{t.title}</button>
      ))}
    </nav>
  );
}
