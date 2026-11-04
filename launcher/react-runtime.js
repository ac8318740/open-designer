// OpenDesigner React runtime. esbuild bundles this into every React design
// build; the launcher never runs it. It writes the bridge's data-od-*
// attributes on each design-system component's root element and answers the
// bridge's window.__od.props.get(el) from React's committed props.
//
// React keeps no public link from a component to its DOM, so this walks the
// fiber tree the way React DevTools does: the __reactContainer$ key on the
// root element, then child, sibling, memoizedProps, and stateNode.

const fixtures = new WeakMap(); // every object or array inside a fixture -> fixture path
let container = null;
let hosts = new WeakMap(); // component root element -> component fiber, rebuilt each pass

// Tags each component a design-system module exports with its name and source.
export function mark(namespace, source) {
  for (const [key, value] of Object.entries(namespace)) {
    const component = typeof value === "function" || (value && typeof value === "object" && value.$$typeof);
    if (!component || value.__od) continue; // a barrel re-export keeps the defining file
    const name = key === "default" ? value.displayName || value.name || source.split("/").pop().split(".")[0] : key;
    try {
      Object.defineProperty(value, "__od", { value: { name, source } });
    } catch {
      /* frozen export: it renders, just without attributes */
    }
  }
}

// Remembers which fixture file each nested value came from, so a spread
// fixture (<Card {...notebook} />) still names it through its nested values.
export function fixture(data, path) {
  const visit = (v) => {
    if (!v || typeof v !== "object" || fixtures.has(v)) return;
    fixtures.set(v, path);
    for (const child of Object.values(v)) visit(child);
  };
  visit(data);
  return data;
}

export function mount(createRoot, createElement, Page) {
  container = document.getElementById("od-root");
  window.__od = Object.assign(window.__od ?? {}, { props: { get: propsOf } });
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      annotate();
    });
  }).observe(container, { childList: true, subtree: true, characterData: true });
  createRoot(container).render(createElement(Page));
}

function propsOf(el) {
  annotate(); // props may have changed without a DOM mutation
  const fiber = hosts.get(el);
  if (!fiber) return undefined;
  try {
    // Children and other React elements hold fibers, which are circular.
    return JSON.parse(JSON.stringify(fiber.memoizedProps, (_k, v) => (v && v.$$typeof ? undefined : v)));
  } catch {
    return undefined;
  }
}

function annotate() {
  hosts = new WeakMap();
  const key = container && Object.keys(container).find((k) => k.startsWith("__reactContainer$"));
  // stateNode.current is the committed tree; the container key can point at its alternate.
  if (key) walk(container[key].stateNode.current.child);
}

function walk(first) {
  for (let f = first; f; f = f.sibling) {
    const meta = f.type?.__od ?? f.elementType?.__od;
    const el = meta && firstElement(f.child);
    if (el && !hosts.has(el)) {
      // Outer components claim a shared root element first.
      hosts.set(el, f);
      el.setAttribute("data-od-component", meta.name);
      el.setAttribute("data-od-source", meta.source);
      const path = fixtureOf(f.memoizedProps);
      if (path) el.setAttribute("data-od-fixture", path);
      else el.removeAttribute("data-od-fixture");
    }
    walk(f.child);
  }
}

function firstElement(first) {
  for (let f = first; f; f = f.sibling) {
    if (typeof f.type === "string") return f.stateNode;
    const el = firstElement(f.child);
    if (el) return el;
  }
  return null;
}

function fixtureOf(props) {
  for (const v of Object.values(props ?? {})) {
    if (v && typeof v === "object" && fixtures.has(v)) return fixtures.get(v);
  }
  return null;
}
