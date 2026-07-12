// Projects tab (default-active): card grid filled by loadProjects() in main.tsx.
export function ProjectsPanel(): Node {
  return (
    <section data-tab="projects" class="active">
      <div class="cards" id="projects"><span class="muted">loading projects…</span></div>
    </section>
  );
}
