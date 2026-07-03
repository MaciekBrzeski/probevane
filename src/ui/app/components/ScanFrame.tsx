// LCARS elbow frame: an asymmetric rounded corner bracket wrapping a panel.
// Pure chrome — the accent hue comes via the --frame CSS custom property.
export function ScanFrame(props: { title: string; accent?: string; children?: unknown }): Node {
  return (
    <div class="scanframe" style={props.accent ? `--frame:${props.accent}` : undefined}>
      <div class="sf-elbow"></div>
      <div class="sf-title">{props.title}</div>
      <div class="sf-body">{props.children}</div>
    </div>
  );
}
