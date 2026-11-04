// In-frame bridge script, protocol version 1. Runs inside the sandboxed
// design frame and talks to the host only through postMessage. It owns the
// picker, token and tweak styles, marks, scroll reporting, and key forwarding.
//
// Built as one standalone classic script (see buildBridgeScript in
// vite-plugins/data-server.ts), so this file may import types only.
// ACStack vendors a pinned copy of the build.

import type { Mark, Restore, Selection, SelectionComponent, TokenSheet } from "./protocol";

(() => {
  // Duplicated from protocol.ts: a value import would break the one-file build.
  const OD = 1;
  const MAX_MESSAGE_CHARS = 256 * 1024;
  const MAX_SELECTIONS = 20;
  const HTML_LIMIT = 2048;
  const TEXT_LIMIT = 200;
  const SELECTOR_LIMIT = 1024;
  const PROPS_LIMIT = 8 * 1024;
  const SNAPSHOT_APP_LIMIT = 64 * 1024;
  const MAX_MARKS = 100;
  const MAX_TWEAKS = 200;
  const STYLESHEET_WAIT_MS = 300;
  const SCROLL_INTERVAL_MS = 100;
  const VAR_KEY = /^--[A-Za-z0-9_-]+$/;
  const ATTR_KEY = /^data-[a-z0-9-]+$/;
  const BAD_VALUE = /[;{}<>]|\/\*/;
  const CAPABILITIES = [
    "init", "tokens", "tweaks", "picker", "selection-clear", "selection-remove",
    "marks", "reveal", "snapshot-request",
  ];
  const HOVER_ID = "od-picker-hover";
  const SELECTED_ATTR = "data-od-selected";
  const BADGE_CLASS = "od-picker-badge";
  const MARK_CLASS = "od-mark-badge";
  const HOST_CLASS = "od-badge-host";
  const GUTTER_CLASS = "od-badge-gutter";
  const MARK_ATTR = "data-od-mark";
  const FLASH_ATTR = "data-od-flash";
  const STYLE_KEYS = [
    "display", "position", "padding", "margin", "width", "height", "color",
    "background-color", "background-image", "border", "border-radius", "box-shadow",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "text-align", "flex-direction", "justify-content", "align-items", "gap",
    "grid-template-columns", "grid-template-rows",
  ];

  type Data = Record<string, unknown>;
  interface Picked { id: number; el: HTMLElement; snap: Selection }
  interface OdHooks {
    props?: { get(el: Element): unknown };
    saveState?: () => unknown;
    restoreState?: (state: unknown) => void;
  }

  if (window.parent === window) return; // opened directly: nobody to talk to

  let session: string | null = null;
  let pickerOn = false;
  let keys = new Set<string>();
  let picked: Picked[] = [];
  // A picked element's badge, which may sit in a child cell rather than the element itself.
  const pickBadges = new WeakMap<HTMLElement, HTMLElement>();
  let marks: Mark[] = [];
  let tweakAttrs: string[] = [];
  let queuedError: Data | null = null;
  let warned = false;

  const hooks = (): OdHooks => ((window as unknown as { __od?: OdHooks }).__od ?? {});
  const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
  const isStr = (v: unknown, max = Infinity): v is string => typeof v === "string" && v.length <= max;
  const jsonSize = (v: unknown): number => {
    try {
      return JSON.stringify(v)?.length ?? Infinity;
    } catch {
      return Infinity;
    }
  };

  function post(type: string, payload: Data = {}): void {
    if (type !== "ready" && !session) return;
    window.parent.postMessage({ ...payload, od: OD, type, ...(session ? { session } : {}) }, "*");
  }

  function drop(reason: string): void {
    if (warned) return;
    warned = true;
    console.warn(`[od] bridge dropped a host message: ${reason}`);
  }

  // --- Host messages -------------------------------------------------------

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return drop("wrong source window");
    const d = e.data;
    if (!isObj(d) || jsonSize(d) > MAX_MESSAGE_CHARS) return drop("over 256 KiB");
    if (d.od !== OD) return drop("wrong od");
    if (d.type === "init" ? session !== null || !isStr(d.session, 200) : d.session !== session || !session) {
      return drop("stale session");
    }
    const handler = typeof d.type === "string" ? HANDLERS[d.type] : undefined;
    if (!handler) return; // unknown types drop silently
    if (handler(d) === false) drop(`bad ${d.type} shape`);
  });

  const HANDLERS: Record<string, (d: Data) => boolean | void> = {
    init(d) {
      if (!Array.isArray(d.keys) || typeof d.picker !== "boolean") return false;
      keys = new Set(d.keys.filter((k): k is string => typeof k === "string"));
      // Applied before the session is set, so these send no early `applied`.
      if (d.tokens !== undefined) HANDLERS.tokens({ sheets: d.tokens });
      if (isObj(d.tweaks)) HANDLERS.tweaks(d.tweaks);
      if (d.marks !== undefined) HANDLERS.marks({ items: d.marks });
      session = d.session as string;
      setPicker(d.picker);
      const restore = isObj(d.restore) ? (d.restore as Restore) : null;
      restoreScroll(restore);
      if (restore && restore.app !== undefined) {
        try {
          hooks().restoreState?.(restore.app);
        } catch (err) {
          reportError(err);
        }
      }
      if (restore && Array.isArray(restore.selections)) reselect(restore.selections);
      if (queuedError) post("error", queuedError);
      queuedError = null;
      waitForStylesheets().then(() =>
        requestAnimationFrame(() => {
          restoreScroll(restore); // stylesheets can change the page height
          sendApplied();
        }),
      );
    },
    tokens(d) {
      const sheets = d.sheets;
      if (!Array.isArray(sheets)) return false;
      const ok = sheets.every(
        (s) => isObj(s) && isStr(s.name, 200) && isStr(s.css) && !/<\/style/i.test(s.css),
      );
      if (!ok) return false;
      for (const el of Array.from(document.querySelectorAll("style[data-od-tokens]"))) el.remove();
      const head = document.head ?? document.documentElement;
      const anchor = head.firstChild;
      for (const s of sheets as TokenSheet[]) {
        const style = document.createElement("style");
        style.setAttribute("data-od-tokens", s.name);
        style.textContent = s.css;
        head.insertBefore(style, anchor);
      }
      if (session) requestAnimationFrame(sendApplied);
    },
    tweaks(d) {
      if (!isObj(d.vars) || !isObj(d.attrs)) return false;
      const vars = entries(d.vars, VAR_KEY);
      const attrs = entries(d.attrs, ATTR_KEY);
      if (vars.length + attrs.length > MAX_TWEAKS) return false;
      let style = document.querySelector<HTMLStyleElement>("style[data-od-tweaks]");
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-od-tweaks", "");
        (document.head ?? document.documentElement).appendChild(style);
      }
      style.textContent = `:root { ${vars.map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
      const root = document.documentElement;
      for (const name of tweakAttrs) if (!(name in (d.attrs as Data))) root.removeAttribute(name);
      for (const [k, v] of attrs) root.setAttribute(k, v);
      tweakAttrs = attrs.map(([k]) => k);
      if (session) requestAnimationFrame(sendApplied);
    },
    picker(d) {
      if (typeof d.on !== "boolean") return false;
      setPicker(d.on);
    },
    // Host-initiated changes need no echo: the host already updated its copy.
    "selection-clear"() {
      clearSelections();
    },
    "selection-remove"(d) {
      if (typeof d.id !== "number") return false;
      const i = picked.findIndex((p) => p.id === d.id);
      if (i !== -1) removeAt(i);
    },
    marks(d) {
      const items = d.items;
      if (!Array.isArray(items) || items.length > MAX_MARKS) return false;
      const ok = items.every(
        (m) => isObj(m) && isStr(m.key, 1024) && typeof m.label === "number" && isStr(m.selector, SELECTOR_LIMIT),
      );
      if (!ok) return false;
      marks = items as Mark[];
      drawMarks();
    },
    reveal(d) {
      let selector = d.selector;
      if (selector === undefined && isStr(d.key)) selector = marks.find((m) => m.key === d.key)?.selector;
      const el = isStr(selector, SELECTOR_LIMIT) ? query(selector) : null;
      if (!el) return post("revealed", { found: false });
      el.scrollIntoView({ block: "center" });
      el.setAttribute(FLASH_ATTR, "");
      setTimeout(() => el.removeAttribute(FLASH_ATTR), 1200);
      post("revealed", { found: true, rect: rectOf(el) });
    },
    "snapshot-request"() {
      let app: unknown;
      try {
        app = hooks().saveState?.();
      } catch (err) {
        reportError(err);
      }
      const keep = app !== undefined && jsonSize(app) <= SNAPSHOT_APP_LIMIT;
      post("snapshot", { scroll: { x: window.scrollX, y: window.scrollY }, ...(keep ? { app } : {}) });
    },
  };

  // Tweak entries that pass the Refused rules; the rest are dropped.
  function entries(obj: Data, key: RegExp): Array<[string, string]> {
    return Object.entries(obj).filter(
      (e): e is [string, string] => key.test(e[0]) && typeof e[1] === "string" && !BAD_VALUE.test(e[1]),
    );
  }

  function query(selector: string): HTMLElement | null {
    try {
      return document.querySelector<HTMLElement>(selector);
    } catch {
      return null;
    }
  }

  function restoreScroll(restore: Restore | null): void {
    const s = restore?.scroll;
    if (s && typeof s.x === "number" && typeof s.y === "number") window.scrollTo(s.x, s.y);
  }

  // --- Applied: background and state-rule report ---------------------------

  function waitForStylesheets(): Promise<void> {
    const pending = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter(
      (l) => !l.sheet,
    );
    if (pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let remaining = pending.length;
      const one = () => {
        if (--remaining <= 0) resolve();
      };
      for (const l of pending) {
        l.addEventListener("load", one, { once: true });
        l.addEventListener("error", one, { once: true });
      }
      setTimeout(resolve, STYLESHEET_WAIT_MS);
    });
  }

  function sendApplied(): void {
    post("applied", { background: background(), stateRules: hasStateRules() });
  }

  function background(): string | null {
    const pick = (el: Element | null): string | null => {
      if (!el) return null;
      const bg = getComputedStyle(el).backgroundColor;
      return !bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent" ? null : bg;
    };
    return pick(document.documentElement) ?? pick(document.body);
  }

  // A linked sheet is cross-origin to this opaque frame and cannot be read,
  // so an unreadable sheet counts as "may select on [data-state]".
  function hasStateRules(): boolean {
    const walk = (rules: CSSRuleList): boolean =>
      Array.from(rules).some(
        (r) =>
          (r instanceof CSSStyleRule && r.selectorText.includes("data-state")) ||
          (r instanceof CSSGroupingRule && walk(r.cssRules)),
      );
    return Array.from(document.styleSheets).some((sheet) => {
      try {
        return walk(sheet.cssRules);
      } catch {
        return true;
      }
    });
  }

  // --- Picker --------------------------------------------------------------

  function ensurePickerChrome(): HTMLElement {
    let hover = document.getElementById(HOVER_ID);
    if (hover) return hover;
    const style = document.createElement("style");
    style.setAttribute("data-od-bridge", "");
    style.textContent = `
      #${HOVER_ID} { position: fixed; box-sizing: border-box; pointer-events: none; outline: 2px dashed #f59e0b;
        outline-offset: 2px; background: rgba(245, 158, 11, 0.06); z-index: 2147483646; display: none; }
      body:not(.od-picker-on) #${HOVER_ID} { display: none !important; }
      [${SELECTED_ATTR}] { outline: 2px solid #f59e0b !important; outline-offset: 2px; position: relative; }
      [${MARK_ATTR}] { position: relative; }
      [${FLASH_ATTR}] { outline: 3px solid #3b82f6 !important; outline-offset: 2px; }
      .${HOST_CLASS} { position: relative; }
      .${BADGE_CLASS}, .${MARK_CLASS} { position: absolute; top: -3px; left: -3px; transform: translate(var(--od-bx, -100%), var(--od-by, -100%)); min-width: 22px; height: 22px;
        padding: 0 4px; box-sizing: border-box; border-radius: 11px; background: #f59e0b; color: #1f1300;
        font: 600 12px/22px ui-sans-serif, system-ui, sans-serif; text-align: center;
        z-index: 2147483647; pointer-events: none; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); }
      .${MARK_CLASS} { --od-bx: 100%; background: #3b82f6; color: #fff; left: auto; right: -3px; pointer-events: auto; cursor: pointer; }
      .${BADGE_CLASS}.${GUTTER_CLASS}, .${MARK_CLASS}.${GUTTER_CLASS} { --od-bx: -100%; --od-by: -50%; top: 50%; left: -6px; right: auto; }
    `;
    (document.head ?? document.documentElement).appendChild(style);
    hover = document.createElement("div");
    hover.id = HOVER_ID;
    document.body.appendChild(hover);
    return hover;
  }

  function setPicker(on: boolean): void {
    pickerOn = on;
    if (!document.body) return;
    const hover = ensurePickerChrome();
    document.body.classList.toggle("od-picker-on", on);
    if (!on) hover.style.display = "none";
  }

  const isChrome = (el: Element): boolean =>
    el.id === HOVER_ID || el.classList.contains(BADGE_CLASS) || el.classList.contains(MARK_CLASS);

  document.addEventListener("mousemove", (e) => {
    const target = e.target as HTMLElement | null;
    if (!pickerOn || !target || !(target instanceof Element) || isChrome(target)) return;
    const hover = ensurePickerChrome();
    const r = target.getBoundingClientRect();
    Object.assign(hover.style, {
      display: "block",
      top: `${r.top}px`,
      left: `${r.left}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  });
  document.addEventListener("mouseleave", () => {
    const hover = document.getElementById(HOVER_ID);
    if (hover) hover.style.display = "none";
  });

  function onPickClick(e: MouseEvent, target: HTMLElement): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      clearSelections();
      addSelection(target);
      return sendSelection();
    }
    const existing = picked.findIndex((p) => p.el === target);
    if (existing !== -1) {
      removeAt(existing);
      return sendSelection();
    }
    if (picked.length >= MAX_SELECTIONS) return sendSelection(true);
    addSelection(target);
    sendSelection();
  }

  // Hide badges while reading: innerText on a detached clone would lose layout line breaks.
  function textWithoutBadges(el: HTMLElement): string {
    const badges = Array.from(el.querySelectorAll<HTMLElement>(`.${BADGE_CLASS}, .${MARK_CLASS}`));
    const prev = badges.map((b) => b.style.display);
    badges.forEach((b) => { b.style.display = "none"; });
    try { return el.innerText ?? ""; }
    finally { badges.forEach((b, i) => { b.style.display = prev[i]; }); }
  }

  function addSelection(el: HTMLElement): void {
    const id = picked.length + 1;
    const snap: Selection = {
      id,
      selector: computeSelector(el).slice(0, SELECTOR_LIMIT),
      rect: rectOf(el),
      html: (el.outerHTML ?? "").slice(0, HTML_LIMIT),
      text: textWithoutBadges(el).trim().slice(0, TEXT_LIMIT),
      styles: collectStyles(el),
    };
    const component = componentOf(el);
    if (component) snap.component = component;
    picked.push({ id, el, snap });
    el.setAttribute(SELECTED_ATTR, String(id));
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.textContent = String(id);
    attachBadge(el, badge);
    pickBadges.set(el, badge);
  }

  // Badges sit outside a corner of the element and flip inward at the page edge, so they never widen the page.
  // A table row cannot position a child, so its badge goes in the leading gutter of its first cell.
  function attachBadge(el: HTMLElement, badge: HTMLElement): void {
    const cell = el instanceof HTMLTableRowElement ? (el.cells[0] as HTMLElement | undefined) : undefined;
    if (cell) {
      cell.classList.add(HOST_CLASS);
      badge.classList.add(GUTTER_CLASS);
    }
    (cell ?? el).appendChild(badge);
    const r = badge.getBoundingClientRect();
    if (r.left + window.scrollX < 0 || r.right + window.scrollX > document.documentElement.clientWidth) badge.style.setProperty("--od-bx", "0%");
    if (r.top + window.scrollY < 0) badge.style.setProperty("--od-by", "0%");
  }

  function removeAt(index: number): void {
    const [gone] = picked.splice(index, 1);
    unmark(gone.el);
    picked.forEach((p, i) => {
      p.id = p.snap.id = i + 1;
      p.el.setAttribute(SELECTED_ATTR, String(p.id));
      const badge = pickBadges.get(p.el);
      if (badge) badge.textContent = String(p.id);
    });
  }

  function unmark(el: HTMLElement): void {
    el.removeAttribute(SELECTED_ATTR);
    pickBadges.get(el)?.remove();
    pickBadges.delete(el);
  }

  function clearSelections(): void {
    for (const p of picked) unmark(p.el);
    picked = [];
  }

  function reselect(selectors: unknown[]): void {
    clearSelections();
    for (const s of selectors) {
      if (picked.length >= MAX_SELECTIONS) break;
      const el = isStr(s, SELECTOR_LIMIT) ? query(s) : null;
      if (el && !picked.some((p) => p.el === el)) addSelection(el);
    }
    sendSelection();
  }

  function sendSelection(limit = false): void {
    post("selection", { items: picked.map((p) => p.snap), ...(limit ? { limit: true } : {}) });
  }

  function rectOf(el: Element): Selection["rect"] {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function componentOf(el: HTMLElement): SelectionComponent | undefined {
    const host = el.closest<HTMLElement>("[data-od-component]");
    if (!host) return undefined;
    const out: SelectionComponent = { name: (host.getAttribute("data-od-component") ?? "").slice(0, 200) };
    const source = host.getAttribute("data-od-source");
    const fixture = host.getAttribute("data-od-fixture");
    if (source) out.source = source.slice(0, 1024);
    if (fixture) out.fixture = fixture.slice(0, 1024);
    let props: unknown = hooks().props?.get(host);
    if (props === undefined && host.hasAttribute("data-od-props")) {
      try {
        props = JSON.parse(host.getAttribute("data-od-props") ?? "");
      } catch {
        props = undefined;
      }
    }
    if (isObj(props)) {
      // Round-trip drops functions and other non-JSON values.
      const clean = JSON.parse(JSON.stringify(props)) as Data;
      if (jsonSize(clean) <= PROPS_LIMIT) {
        out.props = clean;
        out.propsTruncated = false;
      } else {
        out.props = Object.fromEntries(Object.keys(clean).map((k) => [k, "…"]));
        out.propsTruncated = true;
        if (jsonSize(out.props) > PROPS_LIMIT) delete out.props;
      }
    }
    return out;
  }

  function computeSelector(el: HTMLElement): string {
    if (el.dataset.testid) return `[data-testid="${el.dataset.testid}"]`;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    while (node && node !== document.documentElement && node.nodeType === 1) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      // Bridge-owned classes (od-picker-on, badges) come and go, so a selector naming them stops matching.
      const cls = typeof node.className === "string" ? node.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("od-")).slice(0, 2) : [];
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        const tag = node.tagName;
        const same = Array.from(parent.children).filter((c) => c.tagName === tag);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
      if (parts.length > 6) break;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  function collectStyles(el: HTMLElement): Record<string, string> {
    const computed = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const key of STYLE_KEYS) {
      const value = computed.getPropertyValue(key);
      if (value && value !== "none" && value !== "normal" && value !== "auto") out[key] = value.trim();
    }
    return out;
  }

  // --- Marks ---------------------------------------------------------------

  function drawMarks(): void {
    for (const el of Array.from(document.querySelectorAll(`.${MARK_CLASS}`))) el.remove();
    for (const el of Array.from(document.querySelectorAll(`[${MARK_ATTR}]`))) el.removeAttribute(MARK_ATTR);
    if (!document.body) return;
    ensurePickerChrome();
    for (const m of marks) {
      const el = query(m.selector);
      if (!el) continue;
      el.setAttribute(MARK_ATTR, "");
      const badge = document.createElement("span");
      badge.className = MARK_CLASS;
      badge.textContent = String(Math.trunc(m.label)); // a number only, never comment text
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        post("mark-click", { key: m.key });
      });
      attachBadge(el, badge);
    }
  }

  // --- Clicks: picking, page navigation, and self-navigation guard ---------

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || !(target instanceof Element) || isChrome(target)) return;
      if (pickerOn) return onPickClick(e, target);
      const page = target.closest("[data-od-page]");
      if (page) {
        e.preventDefault();
        const [p, v] = (page.getAttribute("data-od-page") ?? "").split(":");
        if (p) post("navigate", { page: p, ...(v ? { variant: v } : {}) });
        return;
      }
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      const url = new URL(link.href, location.href);
      const here = new URL(location.href);
      const fragmentOnly =
        url.hash !== "" && url.origin === here.origin && url.pathname === here.pathname && url.search === here.search;
      if (!fragmentOnly && !link.getAttribute("href")!.startsWith("#")) e.preventDefault();
    },
    true,
  );

  // --- Keys ----------------------------------------------------------------

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && pickerOn) {
        e.preventDefault();
        setPicker(false);
        post("picker", { on: false });
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("mod");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.code === "Comma" ? "comma" : e.key.toLowerCase());
      const combo = parts.join("+");
      if (!keys.has(combo)) return;
      // A bare key like Escape still reaches the design's own handlers.
      if (parts.length > 1) {
        e.preventDefault();
        e.stopPropagation();
      }
      post("key", { combo });
    },
    true,
  );

  // --- Scroll, resize, errors ----------------------------------------------

  let scrollTimer: number | null = null;
  window.addEventListener("scroll", () => {
    if (scrollTimer !== null) return;
    scrollTimer = window.setTimeout(() => {
      scrollTimer = null;
      post("scroll", { x: window.scrollX, y: window.scrollY });
    }, SCROLL_INTERVAL_MS);
  });

  function reportError(err: unknown, source?: string, line?: number): void {
    const message = String(err instanceof Error ? err.message : err).slice(0, 2048);
    const payload: Data = { message, ...(source ? { source: source.slice(0, 2048) } : {}), ...(line ? { line } : {}) };
    if (session) post("error", payload);
    else queuedError ??= payload;
  }
  window.addEventListener("error", (e) => reportError(e.message || e.error, e.filename, e.lineno));

  function boot(): void {
    if (typeof ResizeObserver !== "undefined") {
      let queued = false;
      new ResizeObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          post("resize", { height: document.documentElement.scrollHeight });
        });
      }).observe(document.documentElement);
    }
    post("ready", { page: location.pathname, variant: null, capabilities: CAPABILITIES });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
