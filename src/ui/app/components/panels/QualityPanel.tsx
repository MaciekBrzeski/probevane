// Quality tab: dir + scan form; results pre filled by the qbtn handler in main.tsx.
export function QualityPanel(): Node {
  return (
    <section data-tab="quality">
      <div class="panel wide">
        <h2>quality <span id="qmeta" class="muted"></span></h2>
        <div class="row"><label>dir</label><input type="text" id="qdir" placeholder="/path/to/project" /><button class="ghost" id="qbtn">scan</button></div>
        <pre id="quality" class="muted">enter a dir + scan to see file-size / complexity / duplication findings.</pre>
      </div>
    </section>
  );
}
