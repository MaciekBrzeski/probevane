// Tab strip. Click handling stays event-delegated on #tabs (wired in main.tsx),
// exactly like the original inline script.
export function Tabs(): Node {
  return (
    <nav class="tabs" id="tabs">
      <button data-go="projects" class="active">Projects</button>
      <button data-go="runs">Runs</button>
      <button data-go="docs">Docs</button>
      <button data-go="launch">Launch</button>
      <button data-go="cost">Cost / Alerts</button>
      <button data-go="quality">Quality</button>
      <button data-go="console">Console</button>
      <button data-go="terminal">Terminal</button>
    </nav>
  );
}
