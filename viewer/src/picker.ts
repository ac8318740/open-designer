// Element picker overlay. Injected into each iframe that loads a draft.
// All logic written from scratch – do not import or paste from any
// AGPL-licensed source.

import { buildPayload, type SelectionContext } from "./clipboard";

interface ActiveSelection {
  iframe: HTMLIFrameElement;
  project: string;
  file: string;
  element: HTMLElement;
  selector: string;
  rect: DOMRect;
  outerHTML: string;
  styles: Record<string, string>;
}

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

const HOVER_OUTLINE_STYLE_ID = "od-overlay-style";
const HOVER_BOX_ID = "od-hover-box";
const HOVER_LABEL_ID = "od-hover-label";

let panelEl: HTMLElement | null = null;
let activeSelection: ActiveSelection | null = null;
let toastTimer: number | null = null;

export function attachPicker(iframe: HTMLIFrameElement, project: string, file: string): void {
  const doc = iframe.contentDocument;
  if (!doc) return; // cross-origin – not expected, drafts share the launcher origin
  injectIframeStyles(doc);
  ensureHoverChrome(doc);

  doc.addEventListener("mousemove", (e) => onIframeMouseMove(e, doc));
  doc.addEventListener("mouseleave", () => clearHoverChrome(doc));
  doc.addEventListener(
    "click",
    (e) => {
      onIframeClick(e, iframe, project, file);
    },
    true,
  );
  // Suppress link/button activation while picking.
  doc.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
    },
    true,
  );
}

function injectIframeStyles(doc: Document): void {
  if (doc.getElementById(HOVER_OUTLINE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = HOVER_OUTLINE_STYLE_ID;
  style.textContent = `
    #${HOVER_BOX_ID} {
      position: fixed;
      pointer-events: none;
      border: 2px solid #f59e0b;
      background: rgba(245, 158, 11, 0.08);
      z-index: 2147483646;
      transition: all 60ms ease-out;
      display: none;
    }
    #${HOVER_LABEL_ID} {
      position: fixed;
      pointer-events: none;
      background: #f59e0b;
      color: #1f1300;
      font: 11px ui-sans-serif, system-ui, sans-serif;
      padding: 2px 6px;
      border-radius: 4px;
      z-index: 2147483647;
      display: none;
    }
    #${HOVER_BOX_ID}.frozen {
      border-style: dashed;
      background: rgba(245, 158, 11, 0.15);
    }
  `;
  doc.head.appendChild(style);
}

function ensureHoverChrome(doc: Document): void {
  if (!doc.getElementById(HOVER_BOX_ID)) {
    const box = doc.createElement("div");
    box.id = HOVER_BOX_ID;
    doc.body.appendChild(box);
  }
  if (!doc.getElementById(HOVER_LABEL_ID)) {
    const label = doc.createElement("div");
    label.id = HOVER_LABEL_ID;
    doc.body.appendChild(label);
  }
}

function clearHoverChrome(doc: Document): void {
  const box = doc.getElementById(HOVER_BOX_ID);
  const label = doc.getElementById(HOVER_LABEL_ID);
  if (box && !box.classList.contains("frozen")) box.style.display = "none";
  if (label) label.style.display = "none";
}

function onIframeMouseMove(e: MouseEvent, doc: Document): void {
  const target = e.target as HTMLElement | null;
  if (!target || target.id === HOVER_BOX_ID || target.id === HOVER_LABEL_ID) return;
  if (activeSelection) return; // freeze on selection
  const rect = target.getBoundingClientRect();
  const box = doc.getElementById(HOVER_BOX_ID)!;
  const label = doc.getElementById(HOVER_LABEL_ID)!;
  box.style.display = "block";
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  label.style.display = "block";
  label.style.top = `${Math.max(rect.top - 20, 4)}px`;
  label.style.left = `${rect.left}px`;
  label.textContent = describe(target);
}

function describe(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (el.dataset.testid) return `${tag}[data-testid="${el.dataset.testid}"]`;
  if (el.id) return `${tag}#${el.id}`;
  if (el.className && typeof el.className === "string") {
    const first = el.className.trim().split(/\s+/)[0];
    if (first) return `${tag}.${first}`;
  }
  return tag;
}

function onIframeClick(
  e: MouseEvent,
  iframe: HTMLIFrameElement,
  project: string,
  file: string,
): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.id === HOVER_BOX_ID || target.id === HOVER_LABEL_ID) return;

  e.preventDefault();
  e.stopPropagation();

  const doc = iframe.contentDocument!;
  const rect = target.getBoundingClientRect();
  const selector = computeSelector(target);
  const styles = collectStyles(target, doc);
  const outerHTML = target.outerHTML ?? "";

  activeSelection = {
    iframe,
    project,
    file,
    element: target,
    selector,
    rect,
    outerHTML,
    styles,
  };

  freezeHoverBox(doc, rect);
  showPanel(activeSelection);
}

function freezeHoverBox(doc: Document, rect: DOMRect): void {
  const box = doc.getElementById(HOVER_BOX_ID);
  const label = doc.getElementById(HOVER_LABEL_ID);
  if (box) {
    box.classList.add("frozen");
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }
  if (label) label.style.display = "none";
}

function clearFrozenBox(): void {
  if (!activeSelection) return;
  const doc = activeSelection.iframe.contentDocument;
  if (!doc) return;
  const box = doc.getElementById(HOVER_BOX_ID);
  if (box) {
    box.classList.remove("frozen");
    box.style.display = "none";
  }
}

function computeSelector(el: HTMLElement): string {
  // Priority: data-testid -> id -> CSS path with nth-child fallback.
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

function showPanel(sel: ActiveSelection): void {
  removePanel();
  const root = document.getElementById("picker-root")!;

  panelEl = document.createElement("div");
  panelEl.className = "od-panel";
  panelEl.innerHTML = `
    <div class="od-panel-header">
      <span class="od-selector"></span>
      <button class="od-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="od-meta">
      <span class="od-file"></span>
      <span class="od-rect"></span>
    </div>
    <textarea placeholder="What should change about this element?"></textarea>
    <div class="od-actions">
      <button class="od-copy" type="button">Copy</button>
    </div>
  `;
  (panelEl.querySelector(".od-selector") as HTMLElement).textContent = sel.selector;
  (panelEl.querySelector(".od-file") as HTMLElement).textContent = `${sel.project}/${sel.file}`;
  (panelEl.querySelector(".od-rect") as HTMLElement).textContent =
    `${Math.round(sel.rect.width)}×${Math.round(sel.rect.height)}`;

  positionPanel(panelEl, sel.iframe, sel.rect);
  root.appendChild(panelEl);

  const textarea = panelEl.querySelector("textarea") as HTMLTextAreaElement;
  textarea.focus();

  panelEl.querySelector(".od-close")?.addEventListener("click", closePanel);
  panelEl.querySelector(".od-copy")?.addEventListener("click", () => onCopy(textarea.value));
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      onCopy(textarea.value);
    }
  });
}

function positionPanel(panel: HTMLElement, iframe: HTMLIFrameElement, rect: DOMRect): void {
  const iframeRect = iframe.getBoundingClientRect();
  const panelWidth = 320;
  const panelHeight = 240;
  const margin = 8;

  // Anchor: try right of selection, then below, then fall back to top-right of iframe.
  let left = iframeRect.left + rect.right + margin;
  let top = iframeRect.top + rect.top;

  if (left + panelWidth > window.innerWidth - margin) {
    left = iframeRect.left + rect.left - panelWidth - margin;
  }
  if (left < margin) {
    left = Math.max(margin, iframeRect.right - panelWidth - margin);
  }
  if (top + panelHeight > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - panelHeight - margin);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function onCopy(prompt: string): void {
  if (!activeSelection) return;
  const ctx: SelectionContext = {
    project: activeSelection.project,
    file: activeSelection.file,
    selector: activeSelection.selector,
    rect: {
      x: activeSelection.rect.x,
      y: activeSelection.rect.y,
      width: activeSelection.rect.width,
      height: activeSelection.rect.height,
    },
    outerHTML: activeSelection.outerHTML,
    styles: activeSelection.styles,
    prompt,
  };
  const payload = buildPayload(ctx);
  navigator.clipboard
    .writeText(payload)
    .then(() => showToast("Copied – paste into Claude Code."))
    .catch(() => showToast("Clipboard blocked – use ⌘/Ctrl+C from the textarea."));
}

function closePanel(): void {
  removePanel();
  clearFrozenBox();
  activeSelection = null;
}

function removePanel(): void {
  if (panelEl && panelEl.parentNode) {
    panelEl.parentNode.removeChild(panelEl);
  }
  panelEl = null;
}

function showToast(message: string): void {
  let toast = document.querySelector(".od-toast") as HTMLElement | null;
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "od-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove("visible"), 1800);
}
