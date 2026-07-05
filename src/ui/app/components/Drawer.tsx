// Run Detail / Project drawer. Open/close + Escape handling wired in main.tsx.
export function Drawer(): Node {
  return (
    <div class="drawer" id="drawer">
      <div class="dhead"><b id="drawerTitle">detail</b><span class="spacer"></span><button class="ghost" id="drawerClose">✕</button></div>
      <div class="dbody" id="drawerBody"></div>
    </div>
  );
}
