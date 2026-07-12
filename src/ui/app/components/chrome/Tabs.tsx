// Tab strip — rendered from the shared theme SSOT (TABS). Click handling stays
// event-delegated on #tabs (wired in main.tsx). The terminal renders the same
// list, filtered to TERMINAL_TABS.
import { TABS } from '../../../../util/theme.ts';

// Renders the tab strip from TABS; first tab starts active. Kept dumb — click
// handling is event-delegated in main.tsx, so this never re-renders.
export function Tabs(): Node {
  return (
    <nav class="tabs" id="tabs">
      {TABS.map((t, i) => (
        <button data-go={t.id} class={i === 0 ? 'active' : undefined}>{t.title}</button>
      ))}
    </nav>
  );
}
