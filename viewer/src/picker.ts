// Multi-select element picker for open-designer. Written from scratch under MIT.
// Do not import or copy any code from AGPL-licensed sources.

import type { SelectionSnapshot } from "./types";

const STYLE_ID = "od-picker-style";
const HOVER_ID = "od-picker-hover";
const SELECTED_ATTR = "data-od-selected";
const SELECTED_BADGE_CLASS = "od-picker-badge";

const STYLE_KEYS = [
  "display",
  "position",
  "padding",
  "margin",
  "width",
  "height",
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
];

export const MAX_SELECTIONS = 20;

type SelectionListener = (selections: SelectionSnapshot[]) => void;

interface AttachedState {
  iframe: HTMLIFrameElement;
  doc: Document;
  hover: HTMLElement | null;
  handlers: {
    mousemove: (e: MouseEvent) => void;
    mouseleave: () => void;
    click: (e: MouseEvent) => void;
    keydown: (e: KeyboardEvent) => void;
  };
}

export class Picker {
  private enabled = false;
  private selections: SelectionSnapshot[] = [];
  private nextId = 1;
  private listeners = new Set<SelectionListener>();
  private attached: AttachedState | null = null;
  private limitExceededListener: (() => void) | null = null;

  isEnabled(): boolean {
    return this.enabled;
  }

  getSelections(): SelectionSnapshot[] {
    return [...this.selections];
  }

  onChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    listener(this.getSelections());
    return () => this.listeners.delete(listener);
  }

  onLimitExceeded(listener: () => void): void {
    this.limitExceededListener = listener;
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.hideHover();
    this.updateHoverVisibility();
    this.broadcast();
  }

  attach(iframe: HTMLIFrameElement): void {
    this.detach();
    const doc = iframe.contentDocument;
    if (!doc) return;
    this.injectStyles(doc);
    this.ensureHoverBox(doc);

    const handlers = {
      mousemove: (e: MouseEvent) => this.onMouseMove(e),
      mouseleave: () => this.hideHover(),
      click: (e: MouseEvent) => this.onClick(e),
      keydown: (e: KeyboardEvent) => this.onKeydown(e),
    };
    doc.addEventListener("mousemove", handlers.mousemove);
    doc.addEventListener("mouseleave", handlers.mouseleave);
    doc.addEventListener("click", handlers.click, true);
    doc.addEventListener("keydown", handlers.keydown, true);

    this.attached = {
      iframe,
      doc,
      hover: doc.getElementById(HOVER_ID) as HTMLElement,
      handlers,
    };
  }

  detach(): void {
    if (!this.attached) return;
    const { doc, handlers } = this.attached;
    doc.removeEventListener("mousemove", handlers.mousemove);
    doc.removeEventListener("mouseleave", handlers.mouseleave);
    doc.removeEventListener("click", handlers.click, true);
    doc.removeEventListener("keydown", handlers.keydown, true);
    this.clearAll(true);
    this.attached = null;
  }

  clearAll(silent = false): void {
    for (const sel of this.selections) this.unmarkElement(sel.element);
    this.selections = [];
    this.nextId = 1;
    if (!silent) this.broadcast();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.enabled || !this.attached) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.id === HOVER_ID) return;
    if (target.classList?.contains(SELECTED_BADGE_CLASS)) return;
    const rect = target.getBoundingClientRect();
    const hover = this.attached.hover;
    if (!hover) return;
    hover.style.display = "block";
    hover.style.top = `${rect.top}px`;
    hover.style.left = `${rect.left}px`;
    hover.style.width = `${rect.width}px`;
    hover.style.height = `${rect.height}px`;
  }

  private hideHover(): void {
    if (!this.attached?.hover) return;
    this.attached.hover.style.display = "none";
  }

  private updateHoverVisibility(): void {
    if (!this.attached?.doc) return;
    const body = this.attached.doc.body;
    if (!body) return;
    if (this.enabled) body.classList.add("od-picker-on");
    else body.classList.remove("od-picker-on");
  }

  private onClick(e: MouseEvent): void {
    if (!this.enabled || !this.attached) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.id === HOVER_ID || target.classList?.contains(SELECTED_BADGE_CLASS)) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      this.clearAll(true);
      this.addSelection(target);
      this.broadcast();
      return;
    }

    const existing = this.selections.findIndex((s) => s.element === target);
    if (existing !== -1) {
      this.removeAt(existing);
      this.broadcast();
      return;
    }

    if (this.selections.length >= MAX_SELECTIONS) {
      this.limitExceededListener?.();
      return;
    }

    this.addSelection(target);
    this.broadcast();
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.enabled) {
      this.setEnabled(false);
    }
  }

  private addSelection(el: HTMLElement): void {
    if (!this.attached) return;
    const doc = this.attached.doc;
    const rect = el.getBoundingClientRect();
    const snap: SelectionSnapshot = {
      id: this.nextId++,
      element: el,
      selector: computeSelector(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      outerHTML: el.outerHTML ?? "",
      styles: collectStyles(el, doc),
    };
    this.selections.push(snap);
    this.markElement(el, snap.id);
  }

  private removeAt(index: number): void {
    const [removed] = this.selections.splice(index, 1);
    this.unmarkElement(removed.element);
    // Renumber subsequent selections so badges stay contiguous.
    for (let i = index; i < this.selections.length; i++) {
      const s = this.selections[i];
      s.id = i + 1;
      this.updateBadge(s.element, s.id);
    }
    this.nextId = this.selections.length + 1;
  }

  removeById(id: number): void {
    const index = this.selections.findIndex((s) => s.id === id);
    if (index === -1) return;
    this.removeAt(index);
    this.broadcast();
  }

  private markElement(el: HTMLElement, id: number): void {
    el.setAttribute(SELECTED_ATTR, String(id));
    const badge = (el.ownerDocument ?? document).createElement("span");
    badge.className = SELECTED_BADGE_CLASS;
    badge.textContent = String(id);
    badge.setAttribute("data-od-badge-for", String(id));
    el.appendChild(badge);
  }

  private updateBadge(el: HTMLElement, id: number): void {
    el.setAttribute(SELECTED_ATTR, String(id));
    const badge = el.querySelector(`.${SELECTED_BADGE_CLASS}`);
    if (badge) {
      badge.textContent = String(id);
      badge.setAttribute("data-od-badge-for", String(id));
    }
  }

  private unmarkElement(el: HTMLElement): void {
    el.removeAttribute(SELECTED_ATTR);
    const badge = el.querySelector(`.${SELECTED_BADGE_CLASS}`);
    if (badge && badge.parentElement) badge.parentElement.removeChild(badge);
  }

  private broadcast(): void {
    const snapshot = this.getSelections();
    for (const fn of this.listeners) fn(snapshot);
  }

  private injectStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${HOVER_ID} {
        position: fixed;
        pointer-events: none;
        border: 2px dashed #f59e0b;
        background: rgba(245, 158, 11, 0.06);
        z-index: 2147483646;
        display: none;
      }
      [${SELECTED_ATTR}] {
        outline: 2px solid #f59e0b !important;
        outline-offset: 2px;
        position: relative;
      }
      .${SELECTED_BADGE_CLASS} {
        position: absolute;
        top: -10px;
        left: -10px;
        width: 22px;
        height: 22px;
        border-radius: 11px;
        background: #f59e0b;
        color: #1f1300;
        font: 600 12px/22px ui-sans-serif, system-ui, sans-serif;
        text-align: center;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      }
      body:not(.od-picker-on) #${HOVER_ID} {
        display: none !important;
      }
    `;
    doc.head.appendChild(style);
  }

  private ensureHoverBox(doc: Document): void {
    if (doc.getElementById(HOVER_ID)) return;
    const box = doc.createElement("div");
    box.id = HOVER_ID;
    doc.body.appendChild(box);
  }
}

function computeSelector(el: HTMLElement): string {
  if (el.dataset.testid) return `[data-testid="${el.dataset.testid}"]`;
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let node: HTMLElement | null = el;
  const root = el.ownerDocument?.documentElement ?? null;
  while (node && node !== root && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    let part = tag;

    if (node.id) {
      parts.unshift(`#${cssEscape(node.id)}`);
      break;
    }

    const cls =
      typeof node.className === "string"
        ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        : [];
    if (cls.length) part += "." + cls.map(cssEscape).join(".");

    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => (c as HTMLElement).tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        const index = sameTag.indexOf(node) + 1;
        part += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(part);
    node = node.parentElement;
    if (parts.length > 6) break;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function collectStyles(el: HTMLElement, doc: Document): Record<string, string> {
  const win = doc.defaultView;
  if (!win) return {};
  const computed = win.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const key of STYLE_KEYS) {
    const value = computed.getPropertyValue(key);
    if (value && value !== "none" && value !== "normal" && value !== "auto") {
      out[key] = value.trim();
    }
  }
  return out;
}
