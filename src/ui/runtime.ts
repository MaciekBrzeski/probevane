// Tiny JSX runtime for the control center — no framework. h() builds REAL DOM
// nodes (the successor of control.html's old `el()` helper), so components are
// plain functions returning Node. esbuild compiles .tsx with jsxFactory h /
// jsxFragment Fragment; capitalized tags resolve to src/ui/components/<Name>.tsx
// by CONVENTION (see scripts/build-ui.mjs — a missing file is a compile error,
// so component paths are findable at compile time and imports are never written
// by hand).

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown> | null;

// JSX factory: component tags are plain functions and get called; intrinsic
// tags build a real element with props applied and children appended.
export function h(
  tag: string | ((props: Record<string, unknown>) => Node),
  props: Props,
  ...children: Child[]
): Node {
  if (typeof tag === 'function') return tag({ ...(props ?? {}), children });
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) applyProp(node, k, v);
  append(node, children);
  return node;
}

// Map one JSX prop onto the element: on* → listener, class → className,
// dataset merge, known DOM property, else attribute — in that priority order.
export function applyProp(node: HTMLElement, k: string, v: unknown): void {
  if (v === null || v === undefined || v === false) return;
  if (k.startsWith('on') && typeof v === 'function') {
    node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    return;
  }
  if (k === 'class' || k === 'className') { node.className = String(v); return; }
  if (k === 'dataset' && typeof v === 'object') { Object.assign(node.dataset, v as Record<string, string>); return; }
  setPropOrAttr(node, k, v);
}

// Known DOM property → assign it (value, checked, htmlFor …); read-only reflected
// props (e.g. `list` on <input>) and unknown keys → setAttribute.
export function setPropOrAttr(node: HTMLElement, k: string, v: unknown): void {
  if (k in node && k !== 'style') {
    try { (node as unknown as Record<string, unknown>)[k] = v; return; } catch { /* read-only getter */ }
  }
  node.setAttribute(k, String(v));
}

// JSX fragment: children into a DocumentFragment — grouping without a wrapper.
export function Fragment(props: { children?: Child[] }): Node {
  const frag = document.createDocumentFragment();
  append(frag, props.children ?? []);
  return frag;
}

// Append children, flattening nested arrays and skipping null/undefined/false
// so JSX conditionals ({cond && ...}) just work.
function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Replace a container's content — the render primitive for panel refreshes. */
export function mount(container: Element, node: Node): void {
  container.textContent = '';
  container.appendChild(node);
}

// --- JSX typings: every intrinsic tag accepts standard props; components are
// checked by their function signatures. Kept permissive on purpose — the value
// is compile-time RESOLUTION (does the component exist?) + prop typos on
// components, not exhaustive DOM attribute modeling.
declare global {
  namespace JSX {
    type Element = Node;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}
