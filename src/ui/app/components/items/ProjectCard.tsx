import { esc, type ProjectInfo } from '../../lib.ts';

// One project card in the Projects grid (ported from the loadProjects loop body).
export function ProjectCard({ p, onOpen }: { p: ProjectInfo; onOpen: (p: ProjectInfo) => void }): Node {
  const st = p.lastRun ? (p.lastRun.accepted ? 'accepted' : p.lastRun.stopReason) : '';
  return (
    <div class="card" dataset={{ slug: p.slug, name: p.name }} onClick={() => onOpen(p)}>
      <h3>{p.name}</h3>
      <div class="muted">{`${p.runCount} run(s) · ${(p.acceptRate * 100).toFixed(0)}% accepted`}</div>
      {p.lastRun && <span class={'tag ' + esc(st)}>{'last: ' + st}</span>}
    </div>
  );
}
