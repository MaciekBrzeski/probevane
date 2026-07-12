// Launch tab: dir/op/flags form; the RUN button handler lives in main.tsx.
export function LaunchPanel(): Node {
  return (
    <section data-tab="launch">
      <div class="panel wide">
        <h2>run — write tests · refactor · feature · fix · quality</h2>
        <div class="row">
          <label>dir</label><input type="text" id="dir" placeholder="/path/to/project" />
          <label>op</label><select id="op"></select>
          <label>flags</label><input type="text" id="flags" placeholder="--kind unit --model ollama" style="width:280px" />
          <button class="act" id="run">RUN ▶</button>
          <span id="runMsg" class="muted"></span>
        </div>
      </div>
    </section>
  );
}
