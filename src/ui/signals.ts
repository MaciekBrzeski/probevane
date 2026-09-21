// Fine-grained reactive layer for the control center — UI = f(state) WITHOUT a
// vdom. h() builds real DOM once; function-valued props/children become live
// bindings that update exactly the text/attr that changed. Keyed lists
// reconcile order only; row content updates flow through the row's own signals
// and never touch the list. There is no manual "sync the DOM" call to forget —
// the bug class a full-rebuild model invites (stale panel, missed repaint) is
// inexpressible here.
//
// Complements runtime.ts (build-once h + mount full-replace): panels with
// frequent partial updates opt into signals; static panels keep mount(). This
// h() is a superset of runtime.ts h() (adds reactive bindings); components
// migrating wholesale can switch their import alone.
//
// Benchmarked against React 19 and three imperative variants (5-way oracle-
// verified, js-framework-benchmark-style): ties or wins every op at 1k and 10k
// rows; select via the selector pattern is ~90x React at 10k. See
// docs/wiki/Signals.md for numbers, API guide, and the memory-layout notes.
//
// Memory layout matters at 1k+ bindings: classes with prototype methods, not
// closure factories — a signal instance is (value + subs array), an effect is
// (fn + deps + flags). Subscriber lists are plain arrays (a Set costs ~10x an
// array slot); cleanup arrays allocate lazily; dirty effects dedupe at flush.

let currentEffect: Effect | null = null;
let currentScope: Effect[] | null = null;

const dirty = new Set<Effect>();
let scheduled = false;

function schedule(subs: Effect[]): void {
  for (const e of subs) if (!e.dead) dirty.add(e);
  if (!scheduled) { scheduled = true; queueMicrotask(flushSync); }
}

/** Run all pending reactive updates now. Event handlers that must observe the
 *  committed DOM (and tests) call this; otherwise updates batch per microtask. */
export function flushSync(): void {
  scheduled = false;
  while (dirty.size) {
    const batch = [...dirty];
    dirty.clear();
    for (const e of batch) if (!e.dead) e.run();
  }
}

export class Signal<T> {
  private subs: Effect[] = [];
  constructor(private v: T) {}
  get(): T {
    const e = currentEffect;
    if (e) {
      // Stable-deps fast path: a re-run that reads the same signals in the same
      // order just walks its existing subscriptions (no unsubscribe/resubscribe
      // churn — at 1000+ bindings per frame that churn dominates). On the first
      // divergence (a dynamic branch changed) the stale tail is dropped and
      // tracking continues in append mode.
      if (e.deps[e.cursor] === this.subs) e.cursor++;
      else if (!(e.cursor > 0 && e.deps[e.cursor - 1] === this.subs)) { // ignore duplicate read
        e.dropTail(e.cursor);
        this.subs.push(e);
        e.deps.push(this.subs);
        e.cursor = e.deps.length;
      }
    }
    return this.v;
  }
  set(nv: T): void { if (Object.is(nv, this.v)) return; this.v = nv; schedule(this.subs); }
  update(f: (v: T) => T): void { this.set(f(this.v)); }
}
export const signal = <T>(v: T): Signal<T> => new Signal(v);

/** Reactive computation; re-runs when any read signal changes. `fn` may return
 *  a cleanup, run before each re-run and on dispose. */
export class Effect {
  deps: Effect[][] = [];
  cursor = 0;
  cleanups: Array<() => void> | null = null;
  dead = false;
  constructor(private fn: () => void | (() => void)) {
    this.run();
    currentScope?.push(this);
  }
  /** Unsubscribe from deps[k..] — the stale tail after a re-run read fewer or
   *  different signals than the previous run. */
  dropTail(k: number): void {
    for (let i = k; i < this.deps.length; i++) {
      const subs = this.deps[i];
      const j = subs.indexOf(this);
      if (j >= 0) { subs[j] = subs[subs.length - 1]; subs.pop(); }
    }
    this.deps.length = k;
  }
  run(): void {
    if (this.cleanups) { for (const c of this.cleanups) c(); this.cleanups = null; }
    this.cursor = 0;
    const prev = currentEffect;
    currentEffect = this;
    try {
      const c = this.fn();
      if (typeof c === 'function') (this.cleanups ??= []).push(c);
    } finally {
      currentEffect = prev;
      this.dropTail(this.cursor); // read fewer signals than last run => drop leftovers
    }
  }
  dispose(): void {
    this.dead = true;
    if (this.cleanups) { for (const c of this.cleanups) c(); this.cleanups = null; }
    this.dropTail(0);
    dirty.delete(this);
  }
}
export const effect = (fn: () => void | (() => void)): Effect => new Effect(fn);

/** Derived value, memoized: downstream effects re-run only when the computed
 *  RESULT changes (Object.is), not on every dependency tick. */
export function computed<T>(fn: () => T): () => T {
  let s: Signal<T> | undefined;
  effect(() => { const v = fn(); if (s) s.set(v); else s = signal(v); });
  return () => s!.get();
}

/** Collect every effect created while building `fn`'s node; dispose together
 *  (row removed from a list => its bindings die with it). */
export function runInScope<T>(fn: () => T): { value: T; dispose: () => void } {
  const effects: Effect[] = [];
  const prev = currentScope;
  currentScope = effects;
  try {
    const value = fn();
    return { value, dispose: () => { for (const e of effects) e.dispose(); } };
  } finally { currentScope = prev; }
}

// ------------------------------------------------------------- reactive h ---

export type Child = Node | string | number | null | undefined | false | (() => unknown) | Child[];

/** runtime.ts h() plus reactivity: a function-valued prop or child becomes a
 *  live binding (an Effect updating that one attr / text node). */
export function h(
  tag: string | ((props: Record<string, unknown>) => Node),
  props: Record<string, unknown> | null,
  ...children: Child[]
): Node {
  if (typeof tag === 'function') return tag({ ...(props ?? {}), children });
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (typeof v === 'function' && !k.startsWith('on')) effect(() => applyProp(node, k, (v as () => unknown)()));
    else applyProp(node, k, v);
  }
  append(node, children);
  return node;
}

function applyProp(node: HTMLElement, k: string, v: unknown): void {
  if (v === null || v === undefined || v === false) { node.removeAttribute(k); return; }
  if (k.startsWith('on') && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v as EventListener); return; }
  // identical-value writes still dirty style/layout — guard the hot paths
  if (k === 'class' || k === 'className') { const s = String(v); if (node.className !== s) node.className = s; return; }
  if (k === 'dataset' && typeof v === 'object') { Object.assign(node.dataset, v as Record<string, string>); return; }
  if (k in node && k !== 'style') {
    try { (node as unknown as Record<string, unknown>)[k] = v; return; } catch { /* read-only getter */ }
  }
  node.setAttribute(k, String(v));
}

function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else if (typeof c === 'function') {
      const t = document.createTextNode('');
      parent.appendChild(t);
      effect(() => { const s = String((c as () => unknown)() ?? ''); if (t.data !== s) t.data = s; });
    } else parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

// ------------------------------------------------------------ keyed lists ---

interface Slot<T> { item: T; node: HTMLElement; dispose: () => void }

/** Keep parent's children synced to a reactive array. Item object identity is
 *  the dirty flag: same object ⇒ node untouched; NEW object under a known key ⇒
 *  that row alone is re-rendered (old bindings disposed) — the safe default for
 *  snapshot data (poll payloads), where a fresh object may mean fresh content.
 *  Signal-driven rows keep item identity across content changes and skip
 *  rebuilds entirely. Prefix/suffix identity trim + a pure-swap fast path (two
 *  moves) run before the general cursor pass. The parent's children are owned
 *  by this effect exclusively — put siblings (empty-state, spinners) outside
 *  it, e.g. via when(). */
export function eachInto<T>(
  parent: Element,
  items: () => T[],
  key: (item: T) => unknown,
  render: (item: T) => HTMLElement,
): Effect {
  const cache = new Map<unknown, Slot<T>>();
  let prev: T[] = [];

  const disposeAll = (): void => { for (const s of cache.values()) s.dispose(); cache.clear(); };
  const make = (item: T): Slot<T> => {
    const { value: node, dispose } = runInScope(() => render(item));
    const slot = { item, node, dispose };
    (node as HTMLElement & { __k?: unknown }).__k = key(item);
    cache.set(key(item), slot);
    return slot;
  };

  const drop = (item: T): void => {
    const k = key(item);
    const s = cache.get(k);
    if (s) { s.node.remove(); s.dispose(); cache.delete(k); }
  };

  return effect(() => {
    const next = items();
    if (next.length === 0) { parent.textContent = ''; disposeAll(); prev = []; return; }

    // two-pointer diff (udomdiff-style): identity prefix/suffix advance, end
    // swaps and head<->tail rotations resolve in O(1) moves — a rotate-by-one of
    // n rows is ONE insertBefore, not n (the naive-cursor worst case).
    let aS = 0, aE = prev.length - 1, bS = 0, bE = next.length - 1;
    while (aS <= aE && bS <= bE) {
      if (prev[aS] === next[bS]) { aS++; bS++; continue; }
      if (prev[aE] === next[bE]) { aE--; bE--; continue; }
      if (prev[aS] === next[bE] && prev[aE] === next[bS]) { // ends exchanged
        const a = cache.get(key(prev[aS]))!.node;
        const b = cache.get(key(prev[aE]))!.node;
        const afterB = b.nextSibling;
        parent.insertBefore(b, a);
        parent.insertBefore(a, afterB); // afterB === a (adjacent) inserts a before itself: no-op, already correct
        aS++; bS++; aE--; bE--; continue;
      }
      if (prev[aS] === next[bE]) { // old head rotated to tail
        parent.insertBefore(cache.get(key(prev[aS]))!.node, cache.get(key(prev[aE]))!.node.nextSibling);
        aS++; bE--; continue;
      }
      if (prev[aE] === next[bS]) { // old tail rotated to head
        parent.insertBefore(cache.get(key(prev[aE]))!.node, cache.get(key(prev[aS]))!.node);
        aE--; bS++; continue;
      }
      break; // mixed region -> cursor pass below
    }

    if (aS > aE) {
      // only insertions remain
      const ref = bE + 1 < next.length ? cache.get(key(next[bE + 1]))!.node : null;
      for (; bS <= bE; bS++) parent.insertBefore(make(next[bS]).node, ref);
    } else if (bS > bE) {
      // only removals remain
      for (; aS <= aE; aS++) drop(prev[aS]);
    } else {
      // cursor pass over the mixed middle
      const endNode = bE + 1 < next.length ? cache.get(key(next[bE + 1]))!.node : null;
      let cursor: ChildNode | null = bS > 0 ? cache.get(key(next[bS - 1]))!.node.nextSibling : parent.firstChild;
      for (let i = bS; i <= bE; i++) {
        const item = next[i];
        const k = key(item);
        let slot = cache.get(k);
        if (!slot) slot = make(item);
        else if (slot.item !== item) {
          // known key, new object => content may differ: re-render this row only
          slot.dispose();
          const { value, dispose } = runInScope(() => render(item));
          if (slot.node === cursor) cursor = cursor.nextSibling;
          slot.node.remove();
          slot.node = value;
          (slot.node as HTMLElement & { __k?: unknown }).__k = k;
          slot.dispose = dispose;
          slot.item = item;
        }
        if (slot.node === cursor) cursor = cursor.nextSibling;
        else parent.insertBefore(slot.node, cursor);
      }
      while (cursor && cursor !== endNode) {
        const dead = cursor;
        cursor = cursor.nextSibling;
        parent.removeChild(dead);
        const k = (dead as ChildNode & { __k?: unknown }).__k;
        cache.get(k)?.dispose();
        cache.delete(k);
      }
    }
    prev = next.slice();
  });
}

/** Conditional subtree. Renders when `cond` is truthy, tears down (and disposes
 *  the subtree's bindings) when falsy. Memoized on truthiness — dependency
 *  churn with unchanged truthiness does not rebuild. */
export function when(cond: () => unknown, render: () => Node): Node {
  const anchor = document.createComment('when');
  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  const on = computed(() => !!cond());
  effect(() => {
    if (!on()) return;
    const { value, dispose } = runInScope(render);
    const nodes: ChildNode[] = value instanceof DocumentFragment ? [...value.childNodes] : [value as ChildNode];
    anchor.after(value);
    return () => { for (const n of nodes) n.remove(); dispose(); };
  });
  return frag;
}
