import { buildPayload, type PayloadContext } from "./clipboard";
import { mountComposer } from "./composer";
import { MAX_SELECTIONS, Picker } from "./picker";
import {
  applyTweaksToIframe,
  buildInitialValues,
  isPanelOpen,
  loadStoredValues,
  renderTweaksPanel,
  savePanelOpen,
  saveStoredValues,
} from "./tweaks";
import type {
  Chosen,
  ChosenPage,
  DesignEntry,
  DesignIndex,
  DesignSystemEntry,
  DesignSystemIndexPages,
  DesignSystemManifest,
  LegacyChosen,
  NormalizedIndex,
  Page,
  Tweak,
  VariantEntry,
  ViewerMode,
} from "./types";

const DATA_ROOT = "/data";
const ACTIVE_DESIGN_KEY = "od:active-design";
const ACTIVE_DS_KEY = "od:active-ds";
const ACTIVE_MODE_KEY = "od:mode";
const TWEAKS_CORNER_KEY = "od:tweaks-corner";
type Corner = "br" | "bl" | "tr" | "tl";
const CORNERS: Corner[] = ["br", "bl", "tr", "tl"];

interface NormalizedDesign {
  name: string;
  designSystem?: string;
  index: NormalizedIndex;
  pages: Page[];
  chosen?: Chosen;
}

interface NormalizedDS {
  name: string;
  manifest: DesignSystemManifest;
  pages: Page[];
}

function getChosenForPage(design: NormalizedDesign | null, pageId: string | null | undefined): ChosenPage | undefined {
  if (!design || !pageId) return undefined;
  return design.chosen?.pages?.[pageId];
}

function clearPageHistory(): void {
  pageHistory.length = 0;
  renderBackButton();
}

function resolveById<T extends { id: string }>(
  items: T[],
  ...candidates: Array<string | null | undefined>
): T | undefined {
  for (const id of candidates) {
    if (!id) continue;
    const hit = items.find((item) => item.id === id);
    if (hit) return hit;
  }
  return items[0];
}

// State ---------------------------------------------------------------------

const picker = new Picker();
let mode: ViewerMode = "designs";
let designs: NormalizedDesign[] = [];
let designSystems: NormalizedDS[] = [];
let activeDesign: NormalizedDesign | null = null;
let activeDS: NormalizedDS | null = null;
let activePage: Page | null = null;
let activeVariant: VariantEntry | null = null;
let tweakValues: Record<string, string> = {};
const pageHistory: Array<{ pageId: string; variantId: string }> = [];
interface NavOpts { fade?: boolean }

// DOM refs ------------------------------------------------------------------

const iframe = document.getElementById("draft-frame") as HTMLIFrameElement;
const stage = document.getElementById("stage")!;
const emptyState = document.getElementById("empty-state")!;
const emptyStateDs = document.getElementById("empty-state-ds")!;
const projectLabel = document.getElementById("project-label")!;
const designSelect = document.getElementById("design-select") as HTMLSelectElement;
const dsSelect = document.getElementById("ds-select") as HTMLSelectElement;
const modeDesigns = document.getElementById("mode-designs") as HTMLButtonElement;
const modeDesignSystems = document.getElementById("mode-design-systems") as HTMLButtonElement;
const pageSelect = document.getElementById("page-select") as HTMLSelectElement;
const backBtn = document.getElementById("back-btn") as HTMLButtonElement;
const pickerToggle = document.getElementById("picker-toggle") as HTMLButtonElement;
const tweaksToggle = document.getElementById("tweaks-toggle") as HTMLButtonElement;
const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const fullscreenBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement;
const tweaksPanel = document.getElementById("tweaks-panel") as HTMLElement;
const tweaksBody = document.getElementById("tweaks-body")!;
const tweaksClose = document.getElementById("tweaks-close") as HTMLButtonElement;
const composerRoot = document.getElementById("composer") as HTMLElement;
const composerChips = document.getElementById("composer-chips")!;
const composerInput = document.getElementById("composer-input") as HTMLTextAreaElement;
const composerCopy = document.getElementById("composer-copy") as HTMLButtonElement;
const composerClear = document.getElementById("composer-clear") as HTMLButtonElement;

// Bootstrap -----------------------------------------------------------------

const renderComposer = mountComposer({
  root: composerRoot,
  chipsRoot: composerChips,
  input: composerInput,
  copyBtn: composerCopy,
  clearBtn: composerClear,
  getSelections: () => picker.getSelections(),
  onRemove: (id) => picker.removeById(id),
  onClear: () => picker.clearAll(),
  onCopy: (prompt) => onCopy(prompt),
});

picker.onChange((selections) => {
  renderComposer(selections);
  if (selections.length > 0) composerInput.focus({ preventScroll: true });
});
picker.onLimitExceeded(() =>
  showToast(`Limit reached – max ${MAX_SELECTIONS} selections. Remove one to add another.`),
);

pickerToggle.addEventListener("click", () => togglePicker());
tweaksToggle.addEventListener("click", () => toggleTweaksPanel());
tweaksClose.addEventListener("click", () => toggleTweaksPanel(false));
refreshBtn.addEventListener("click", () => refresh());
fullscreenBtn.addEventListener("click", () => enterFullscreen());
designSelect.addEventListener("change", () => selectDesign(designSelect.value));
dsSelect.addEventListener("change", () => selectDS(dsSelect.value));
modeDesigns.addEventListener("click", () => setMode("designs"));
modeDesignSystems.addEventListener("click", () => setMode("design-systems"));
pageSelect.addEventListener("change", () => {
  const current = activeContext();
  if (!current) return;
  const next = current.pages.find((p) => p.id === pageSelect.value);
  if (!next) return;
  clearPageHistory();
  selectPage(next);
});
backBtn.addEventListener("click", () => goBack());

function handleHotkey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    e.stopPropagation();
    togglePicker();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Comma") {
    e.preventDefault();
    e.stopPropagation();
    toggleTweaksPanel();
    return;
  }
  if (e.key === "Escape" && document.body.classList.contains("fullscreen-mode")) {
    e.preventDefault();
    e.stopPropagation();
    exitFullscreen();
  }
}

function enterFullscreen(): void {
  document.body.classList.add("fullscreen-mode");
  showToast("Fullscreen – press Esc to exit.");
}

function exitFullscreen(): void {
  document.body.classList.remove("fullscreen-mode");
}

document.addEventListener("keydown", handleHotkey);
window.addEventListener("message", handleFrameMessage);

mode = loadMode();
applyModeToDom();

const panelStartsOpen = isPanelOpen();
tweaksPanel.hidden = !panelStartsOpen;
tweaksToggle.setAttribute("aria-checked", String(panelStartsOpen));
pickerToggle.setAttribute("aria-checked", "false");
applyCorner(loadCorner());
wirePanelDrag();

refresh().catch((err) => {
  console.error(err);
  showEmpty();
});

// Dev-time hot reload. In production builds `import.meta.hot` is undefined.
if (import.meta.hot) {
  import.meta.hot.on("open-designer:data-changed", (payload: { path: string }) => {
    const path = payload.path;
    if (path.endsWith("/index.json") || path.endsWith("/manifest.json") || path.endsWith("/tokens.css")) {
      refresh();
      return;
    }
    if (!activeVariant) return;
    const url = activeVariantUrl();
    if (url && path === url) {
      reloadActiveVariant();
    }
  });
}

// Active context helpers ----------------------------------------------------

function activeContext(): { pages: Page[] } | null {
  if (mode === "designs") return activeDesign;
  return activeDS;
}

function activeVariantUrl(): string | null {
  if (!activeVariant) return null;
  if (mode === "designs" && activeDesign) {
    return `/designs/${activeDesign.name}/${activeVariant.file}`;
  }
  if (mode === "design-systems" && activeDS) {
    return `/design-systems/${activeDS.name}/pages/${activeVariant.file}`;
  }
  return null;
}

// Normalize -----------------------------------------------------------------

function normalizeIndex(raw: DesignIndex): { index: NormalizedIndex; pages: Page[]; chosen?: Chosen } {
  let pages: Page[];
  if (Array.isArray(raw.pages) && raw.pages.length > 0) {
    pages = raw.pages;
  } else if (Array.isArray(raw.drafts) && raw.drafts.length > 0) {
    pages = [{ id: "main", label: "Main", variants: raw.drafts }];
  } else {
    pages = [];
  }

  let chosen: Chosen | undefined;
  if (raw.chosen) {
    if ("pages" in raw.chosen && raw.chosen.pages) {
      chosen = raw.chosen as Chosen;
    } else if (pages.length > 0) {
      const legacy = raw.chosen as LegacyChosen;
      chosen = {
        finalizedAt: legacy.finalizedAt,
        ...(legacy.shippedAt ? { shippedAt: legacy.shippedAt } : {}),
        pages: {
          [pages[0].id]: {
            variantId: legacy.variantId,
            tweaks: legacy.tweaks ?? {},
          },
        },
      };
    }
  }

  if (chosen) {
    const livePageIds = new Set(pages.map((p) => p.id));
    const filtered: Record<string, ChosenPage> = {};
    for (const [pageId, entry] of Object.entries(chosen.pages)) {
      if (!livePageIds.has(pageId)) continue;
      const page = pages.find((p) => p.id === pageId)!;
      if (!page.variants.some((v) => v.id === entry.variantId)) continue;
      filtered[pageId] = entry;
    }
    chosen = Object.keys(filtered).length > 0
      ? { ...chosen, pages: filtered }
      : undefined;
  }

  const { drafts: _drafts, chosen: _chosen, ...rest } = raw;
  const index: NormalizedIndex = { ...rest, pages };
  if (chosen) index.chosen = chosen;

  return { index, pages, chosen };
}

function normalizeDSPages(raw: DesignSystemIndexPages): Page[] {
  if (Array.isArray(raw.pages) && raw.pages.length > 0) return raw.pages;
  return [];
}

// Mode management ----------------------------------------------------------

function setMode(next: ViewerMode): void {
  if (mode === next) return;
  mode = next;
  saveMode(next);
  applyModeToDom();
  clearPageHistory();
  picker.clearAll();
  // Refresh picks up the active design/DS for the new mode.
  refresh().catch((err) => {
    console.error(err);
    showEmpty();
  });
}

function applyModeToDom(): void {
  modeDesigns.setAttribute("aria-selected", String(mode === "designs"));
  modeDesignSystems.setAttribute("aria-selected", String(mode === "design-systems"));
  document.body.classList.toggle("mode-designs", mode === "designs");
  document.body.classList.toggle("mode-design-systems", mode === "design-systems");
}

function loadMode(): ViewerMode {
  try {
    const raw = localStorage.getItem(ACTIVE_MODE_KEY);
    if (raw === "designs" || raw === "design-systems") return raw;
  } catch {
    /* ignore */
  }
  return "designs";
}

function saveMode(m: ViewerMode): void {
  try {
    localStorage.setItem(ACTIVE_MODE_KEY, m);
  } catch {
    /* ignore */
  }
}

// Data loading --------------------------------------------------------------

async function loadDesigns(): Promise<DesignEntry[]> {
  const out: DesignEntry[] = [];
  try {
    const r = await fetch(`${DATA_ROOT}/designs/index.json`);
    if (r.ok) {
      const j = (await r.json()) as { designs?: string[]; projects?: string[] };
      const names = j.designs ?? j.projects ?? [];
      for (const name of names) {
        const ir = await fetch(`${DATA_ROOT}/designs/${name}/index.json`);
        if (ir.ok) out.push({ design: name, index: (await ir.json()) as DesignIndex });
      }
    }
  } catch (err) {
    console.warn("Failed to load designs:", err);
  }
  return out;
}

async function loadDesignSystems(): Promise<NormalizedDS[]> {
  const out: NormalizedDS[] = [];
  try {
    const r = await fetch(`${DATA_ROOT}/design-systems/index.json`);
    if (r.ok) {
      const j = (await r.json()) as { designSystems?: Array<{ name: string }> };
      const list = j.designSystems ?? [];
      for (const entry of list) {
        const name = entry.name;
        const [manifestRes, pagesRes] = await Promise.all([
          fetch(`${DATA_ROOT}/design-systems/${name}/manifest.json`),
          fetch(`${DATA_ROOT}/design-systems/${name}/pages/index.json`),
        ]);
        if (!manifestRes.ok) continue;
        const manifest = (await manifestRes.json()) as DesignSystemManifest;
        let pages: Page[] = [];
        if (pagesRes.ok) {
          const pj = (await pagesRes.json()) as DesignSystemIndexPages;
          pages = normalizeDSPages(pj);
        }
        out.push({ name, manifest, pages });
      }
    }
  } catch (err) {
    console.warn("Failed to load design systems:", err);
  }
  return out;
}

function resolveExtendsChain(dsName: string | undefined): NormalizedDS[] {
  // Walk extends: from child back to root; return parent→child order.
  const chain: NormalizedDS[] = [];
  const seen = new Set<string>();
  let cur = dsName ? designSystems.find((d) => d.name === dsName) : undefined;
  while (cur && !seen.has(cur.name)) {
    seen.add(cur.name);
    chain.unshift(cur);
    const parentName = cur.manifest.extends;
    if (!parentName) break;
    cur = designSystems.find((d) => d.name === parentName);
  }
  return chain;
}

// Refresh + selection --------------------------------------------------------

async function refresh(): Promise<void> {
  const prevDesignName = activeDesign?.name;
  const prevDSName = activeDS?.name;
  const prevPageId = activePage?.id;
  const prevVariantId = activeVariant?.id;

  // Load both collections – the header dropdowns are always populated, even
  // when the active mode is the other one.
  const [rawDesigns, loadedDS] = await Promise.all([
    loadDesigns(),
    loadDesignSystems(),
  ]);

  designs = rawDesigns.map((r) => {
    const norm = normalizeIndex(r.index);
    return {
      name: r.design,
      designSystem: r.index.designSystem,
      index: norm.index,
      pages: norm.pages,
      chosen: norm.chosen,
    };
  });
  designSystems = loadedDS;

  populateDesignSelect();
  populateDsSelect();

  if (mode === "designs") {
    if (designs.length === 0) {
      showEmpty();
      return;
    }
    emptyState.hidden = true;
    emptyStateDs.hidden = true;
    iframe.hidden = false;

    const storedName = loadActiveDesign();
    const d =
      designs.find((p) => p.name === prevDesignName) ??
      designs.find((p) => p.name === storedName) ??
      designs[0];
    activeDesign = d;
    activeDS = null;
    if (d.pages.length === 0) {
      showEmpty();
      return;
    }
    const page = resolveById(d.pages, prevPageId, loadActivePage(d.name));
    if (!page) {
      showEmpty();
      return;
    }
    selectPage(page, { variantId: prevVariantId });
  } else {
    if (designSystems.length === 0) {
      showEmpty();
      return;
    }
    emptyState.hidden = true;
    emptyStateDs.hidden = true;
    iframe.hidden = false;

    const storedName = loadActiveDS();
    const ds =
      designSystems.find((p) => p.name === prevDSName) ??
      designSystems.find((p) => p.name === storedName) ??
      designSystems[0];
    activeDS = ds;
    activeDesign = null;
    if (ds.pages.length === 0) {
      showEmpty();
      return;
    }
    const page = resolveById(ds.pages, prevPageId, loadActivePage(`ds:${ds.name}`));
    if (!page) {
      showEmpty();
      return;
    }
    selectPage(page, { variantId: prevVariantId });
  }
}

function selectDesign(name: string): void {
  const next = designs.find((p) => p.name === name);
  if (!next) return;
  activeDesign = next;
  saveActiveDesign(name);
  populateDesignSelect();
  clearPageHistory();
  if (next.pages.length === 0) {
    showEmpty();
    return;
  }
  const page = resolveById(next.pages, loadActivePage(next.name));
  if (!page) {
    showEmpty();
    return;
  }
  selectPage(page);
}

function selectDS(name: string): void {
  const next = designSystems.find((d) => d.name === name);
  if (!next) return;
  if (mode === "design-systems") {
    activeDS = next;
    saveActiveDS(name);
    populateDsSelect();
    clearPageHistory();
    if (next.pages.length === 0) {
      showEmpty();
      return;
    }
    const page = resolveById(next.pages, loadActivePage(`ds:${next.name}`));
    if (!page) {
      showEmpty();
      return;
    }
    selectPage(page);
    return;
  }
  // In Designs mode, picking a DS assigns it to the active design for this
  // session so the iframe gets the new token chain. It does not rewrite the
  // design's index.json – that's a skill-side change.
  if (activeDesign) {
    activeDesign.designSystem = name;
    saveActiveDS(name);
    populateDsSelect();
    if (activeVariant) reloadActiveVariant();
  }
}

function selectPage(
  page: Page,
  opts: NavOpts & { variantId?: string | null } = {},
): void {
  const ctx = mode === "designs" ? activeDesign : activeDS;
  if (!ctx) return;
  activePage = page;
  const storageKey = mode === "designs" ? ctx.name : `ds:${ctx.name}`;
  saveActivePage(storageKey, page.id);
  populatePageSelect();

  const variant = resolveById(
    page.variants,
    opts.variantId,
    loadActiveVariant(storageKey, page.id),
  );
  if (!variant) {
    showEmpty();
    return;
  }
  selectVariant(variant, { fade: opts.fade });
}

function selectVariant(variant: VariantEntry, opts: NavOpts = {}): void {
  if (!activePage) return;
  const ctx = mode === "designs" ? activeDesign : activeDS;
  if (!ctx) return;
  activeVariant = variant;
  const storageKey = mode === "designs" ? ctx.name : `ds:${ctx.name}`;
  saveActiveVariant(storageKey, activePage.id, variant.id);
  document.body.classList.remove("no-drafts");

  const tweaks = collectTweaks(activeDesign?.index, activePage, variant);
  const stored = loadStoredValues(storageKey, activePage.id, variant.id);
  tweakValues = buildInitialValues(tweaks, stored);

  const ctxName = ctx.name;
  const pageLabel = activePage.label ?? activePage.id;
  const variantLabel = variant.label ?? variant.id;
  const dsBit = mode === "designs" && activeDesign?.designSystem
    ? ` · ${activeDesign.designSystem}`
    : "";
  projectLabel.textContent = `${ctxName} · ${pageLabel} · ${variantLabel}${dsBit}`;

  const doFade = opts.fade ?? false;
  if (doFade) iframe.classList.add("fading");

  if (mode === "designs" && activeDesign) {
    iframe.src = `${DATA_ROOT}/designs/${activeDesign.name}/${variant.file}`;
  } else if (mode === "design-systems" && activeDS) {
    iframe.src = `${DATA_ROOT}/design-systems/${activeDS.name}/pages/${variant.file}`;
  }
  picker.clearAll();

  iframe.onload = () => {
    normalizeIframeLayout(iframe);
    injectTokensChain(iframe);
    injectNavScript(iframe);
    picker.attach(iframe);
    if (picker.isEnabled()) {
      iframe.contentDocument?.body.classList.add("od-picker-on");
    }
    iframe.contentDocument?.addEventListener("keydown", handleHotkey, true);
    applyTweaksToIframe(iframe, tweaks, tweakValues);
    syncIframeBackground(iframe);
    renderPanel();
    if (doFade) {
      requestAnimationFrame(() => iframe.classList.remove("fading"));
    }
  };
}

function reloadActiveVariant(): void {
  if (!activeVariant) return;
  selectVariant(activeVariant);
}

function collectTweaks(index: NormalizedIndex | undefined, page: Page, variant: VariantEntry): Tweak[] {
  return [
    ...(index?.tweaks ?? []),
    ...(page.tweaks ?? []),
    ...(variant.tweaks ?? []),
  ];
}

function normalizeIframeLayout(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  let style = doc.getElementById("od-viewer-normalize") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "od-viewer-normalize";
    doc.head.appendChild(style);
  }
  style.textContent = "html, body { min-height: 100vh; }";

  if (!doc.getElementById("od-viewer-scrollbar-defaults")) {
    const sb = doc.createElement("style");
    sb.id = "od-viewer-scrollbar-defaults";
    sb.textContent = SCROLLBAR_DEFAULTS_CSS;
    doc.head.prepend(sb);
  }
}

// In designs mode, inject the resolved extends chain's tokens.css in
// parent→child order. The design's own file may also <link> these directly
// for file-open-in-browser compatibility; the additional injection guarantees
// the chain is always present even when the link paths are wrong.
function injectTokensChain(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  // Remove any previously injected chain so a DS swap doesn't stack.
  for (const el of Array.from(doc.querySelectorAll("link[data-od-tokens-link]"))) {
    el.remove();
  }
  const dsName =
    mode === "designs"
      ? activeDesign?.designSystem
      : activeDS?.name;
  if (!dsName) return;
  const chain = resolveExtendsChain(dsName);
  for (const ds of chain) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute("data-od-tokens-link", ds.name);
    link.href = `${DATA_ROOT}/design-systems/${ds.name}/tokens.css`;
    doc.head.prepend(link);
  }
}

function syncIframeBackground(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  const win = doc?.defaultView;
  if (!doc || !win || !doc.body) return;
  const pick = (el: Element): string | null => {
    const bg = win.getComputedStyle(el).backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") return null;
    return bg;
  };
  const bg = pick(doc.documentElement) ?? pick(doc.body);
  frame.style.backgroundColor = bg ?? "";
}

function injectNavScript(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  if (doc.getElementById("od-viewer-nav-script")) return;
  const script = doc.createElement("script");
  script.id = "od-viewer-nav-script";
  script.textContent = NAV_SCRIPT;
  doc.head.prepend(script);
}

const NAV_SCRIPT = `
(function(){
  document.addEventListener('click', function(e){
    var link = e.target.closest('[data-od-page]');
    if (!link) return;
    e.preventDefault();
    var spec = link.getAttribute('data-od-page') || '';
    var parts = spec.split(':');
    parent.postMessage({
      type: 'od:navigate',
      pageId: parts[0],
      variantId: parts[1] || null
    }, '*');
  }, true);
})();
`;

const SCROLLBAR_DEFAULTS_CSS = `
  html {
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: rgba(128, 128, 128, 0.35) transparent;
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.3);
    border: 2px solid transparent;
    background-clip: padding-box;
    border-radius: 999px;
    transition: background-color 180ms ease-out;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(128, 128, 128, 0.6);
  }
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
`;

// Iframe navigation ---------------------------------------------------------

function handleFrameMessage(e: MessageEvent): void {
  const data = e.data;
  if (!data || data.type !== "od:navigate") return;
  if (!activePage || !activeVariant) {
    console.warn("[od] navigate message dropped – viewer not ready", data);
    return;
  }
  const ctx = activeContext();
  if (!ctx) return;

  const targetPageId = String(data.pageId || "");
  const targetVariantId = data.variantId ? String(data.variantId) : null;
  const next = ctx.pages.find((p) => p.id === targetPageId);
  if (!next) {
    showToast(`No page "${targetPageId}" in this ${mode === "designs" ? "design" : "design system"}.`);
    return;
  }

  pageHistory.push({ pageId: activePage.id, variantId: activeVariant.id });
  renderBackButton();
  selectPage(next, { variantId: targetVariantId, fade: true });
}

function goBack(): void {
  const prev = pageHistory.pop();
  renderBackButton();
  const ctx = activeContext();
  if (!prev || !ctx) return;
  const page = ctx.pages.find((p) => p.id === prev.pageId);
  if (!page) return;
  selectPage(page, { variantId: prev.variantId, fade: true });
}

function renderBackButton(): void {
  backBtn.hidden = pageHistory.length === 0;
}

// Selectors -----------------------------------------------------------------

function populateDesignSelect(): void {
  designSelect.innerHTML = "";
  for (const p of designs) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = hasAnyChosen(p.chosen) ? `★ ${p.name}` : p.name;
    if (activeDesign && p.name === activeDesign.name) opt.selected = true;
    designSelect.appendChild(opt);
  }
  document.body.classList.toggle("no-designs", designs.length === 0);
  document.body.classList.toggle("no-multi-design", designs.length < 2);
}

function populateDsSelect(): void {
  dsSelect.innerHTML = "";
  for (const ds of designSystems) {
    const opt = document.createElement("option");
    opt.value = ds.name;
    opt.textContent = ds.manifest.extends ? `${ds.name} (extends ${ds.manifest.extends})` : ds.name;
    if (mode === "design-systems") {
      if (activeDS && ds.name === activeDS.name) opt.selected = true;
    } else {
      if (activeDesign?.designSystem === ds.name) opt.selected = true;
    }
    dsSelect.appendChild(opt);
  }
  document.body.classList.toggle("no-ds", designSystems.length === 0);
}

function populatePageSelect(): void {
  const ctx = activeContext();
  if (!ctx || !activePage) return;
  pageSelect.innerHTML = "";
  for (const p of ctx.pages) {
    const opt = document.createElement("option");
    opt.value = p.id;
    const starred =
      mode === "designs" && getChosenForPage(activeDesign, p.id) ? "★ " : "";
    opt.textContent = `${starred}${p.label ?? p.id}`;
    if (p.id === activePage.id) opt.selected = true;
    pageSelect.appendChild(opt);
  }
  document.body.classList.toggle("no-multi-page", ctx.pages.length < 2);
}

function hasAnyChosen(chosen: Chosen | undefined): boolean {
  if (!chosen || !chosen.pages) return false;
  return Object.keys(chosen.pages).length > 0;
}

// localStorage keys ---------------------------------------------------------

function encKey(...parts: string[]): string {
  return parts.map((p) => encodeURIComponent(p)).join(":");
}

function loadActiveDesign(): string | null {
  try { return localStorage.getItem(ACTIVE_DESIGN_KEY); } catch { return null; }
}
function saveActiveDesign(name: string): void {
  try { localStorage.setItem(ACTIVE_DESIGN_KEY, name); } catch { /* ignore */ }
}
function loadActiveDS(): string | null {
  try { return localStorage.getItem(ACTIVE_DS_KEY); } catch { return null; }
}
function saveActiveDS(name: string): void {
  try { localStorage.setItem(ACTIVE_DS_KEY, name); } catch { /* ignore */ }
}
function loadActivePage(ctxKey: string): string | null {
  try { return localStorage.getItem(`od:active-page:${encodeURIComponent(ctxKey)}`); } catch { return null; }
}
function saveActivePage(ctxKey: string, pageId: string): void {
  try { localStorage.setItem(`od:active-page:${encodeURIComponent(ctxKey)}`, pageId); } catch { /* ignore */ }
}
function loadActiveVariant(ctxKey: string, pageId: string): string | null {
  try { return localStorage.getItem(`od:active-variant:${encKey(ctxKey, pageId)}`); } catch { return null; }
}
function saveActiveVariant(ctxKey: string, pageId: string, variantId: string): void {
  try { localStorage.setItem(`od:active-variant:${encKey(ctxKey, pageId)}`, variantId); } catch { /* ignore */ }
}

// Panel ---------------------------------------------------------------------

function renderPanel(): void {
  if (!activePage || !activeVariant) return;
  const tweaks = collectTweaks(activeDesign?.index, activePage, activeVariant);
  const variants = activePage.variants.map((v) => ({ id: v.id, label: v.label ?? v.id }));
  const chosenForPage = mode === "designs" ? getChosenForPage(activeDesign, activePage.id) : undefined;

  renderTweaksPanel({
    root: tweaksBody,
    variants,
    activeVariant: activeVariant.id,
    onVariant: (id) => {
      if (!activePage) return;
      const next = activePage.variants.find((v) => v.id === id);
      if (next) selectVariant(next);
    },
    tweaks,
    values: tweakValues,
    onChange: (id, value) => {
      tweakValues[id] = value;
      const ctx = activeContext();
      const ctxName = mode === "designs" ? activeDesign?.name : activeDS ? `ds:${activeDS.name}` : "";
      if (ctxName && activePage && activeVariant) {
        saveStoredValues(ctxName, activePage.id, activeVariant.id, tweakValues);
      }
      applyTweaksToIframe(iframe, tweaks, tweakValues);
      syncIframeBackground(iframe);
      void ctx;
    },
    // Chosen + finalize only apply in designs mode.
    chosenVariantId: chosenForPage?.variantId,
    pageLabel: activePage.label ?? activePage.id,
    showFinalizeAll: mode === "designs" && (activeDesign?.pages.length ?? 0) > 1,
    onFinalize: mode === "designs" ? () => finalizePage() : undefined,
    onFinalizeAll: mode === "designs" ? () => finalizeAllPages() : undefined,
    onClearChosen: mode === "designs" ? () => clearChosenPage() : undefined,
    // Promote wiring for DS mode.
    showPromote: mode === "design-systems",
    onPromote: mode === "design-systems" ? (tweak) => promoteTweak(tweak) : undefined,
  });
  renderChosenPill();
  renderBackButton();
  populatePageSelect();
}

function renderChosenPill(): void {
  let pill = document.getElementById("chosen-pill");
  const chosenForPage =
    mode === "designs" ? getChosenForPage(activeDesign, activePage?.id) : undefined;
  const show =
    mode === "designs" &&
    activeDesign &&
    activePage &&
    activeVariant &&
    chosenForPage?.variantId === activeVariant.id;
  if (!show) {
    pill?.remove();
    return;
  }
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "chosen-pill";
    pill.textContent = "★ Chosen variant";
    stage.appendChild(pill);
  }
}

async function finalizePage(): Promise<void> {
  if (!activeDesign || !activePage || !activeVariant) return;
  const entry: ChosenPage = {
    variantId: activeVariant.id,
    tweaks: { ...tweakValues },
  };
  try {
    const res = await postFinalize({
      chosenPage: { pageId: activePage.id, entry },
    });
    applyChosenResponse(res);
    const pageLabel = activePage.label ?? activePage.id;
    const variantLabel = activeVariant.label ?? activeVariant.id;
    showToast(`Finalized – ${pageLabel} is ${variantLabel}. Run the integration skill to port it.`);
  } catch (err) {
    console.error(err);
    showToast(`Finalize failed: ${(err as Error).message}`);
  }
}

async function finalizeAllPages(): Promise<void> {
  if (!activeDesign) return;
  const allPages: Record<string, ChosenPage> = {};
  for (const page of activeDesign.pages) {
    const variantId = loadActiveVariant(activeDesign.name, page.id) ?? page.variants[0]?.id;
    if (!variantId) continue;
    const stored = loadStoredValues(activeDesign.name, page.id, variantId);
    allPages[page.id] = { variantId, tweaks: stored };
  }
  try {
    const res = await postFinalize({ finalizeAll: { pages: allPages } });
    applyChosenResponse(res);
    const count = Object.keys(allPages).length;
    showToast(`Finalized ${count} page${count === 1 ? "" : "s"}.`);
  } catch (err) {
    console.error(err);
    showToast(`Finalize failed: ${(err as Error).message}`);
  }
}

async function clearChosenPage(): Promise<void> {
  if (!activeDesign || !activePage) return;
  try {
    const res = await postFinalize({ clearPage: activePage.id });
    applyChosenResponse(res);
    showToast("Chosen cleared for this page.");
  } catch (err) {
    console.error(err);
    showToast(`Clear failed: ${(err as Error).message}`);
  }
}

async function postFinalize(body: unknown): Promise<{ chosen: Chosen | null }> {
  if (!activeDesign) throw new Error("no active design");
  const r = await fetch(`${DATA_ROOT}/designs/${activeDesign.name}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function applyChosenResponse(res: { chosen: Chosen | null }): void {
  if (!activeDesign) return;
  if (res.chosen) {
    activeDesign.chosen = res.chosen;
    activeDesign.index.chosen = res.chosen;
  } else {
    activeDesign.chosen = undefined;
    delete activeDesign.index.chosen;
  }
  populateDesignSelect();
  populatePageSelect();
  renderPanel();
}

async function promoteTweak(tweak: Tweak): Promise<void> {
  if (!activeDS) return;
  const value = tweakValues[tweak.id];
  if (value === undefined) return;
  try {
    const r = await fetch(`${DATA_ROOT}/design-systems/${activeDS.name}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: tweak.target, value }),
    });
    if (!r.ok) throw new Error(await r.text());
    showToast(`Promoted ${tweak.target} → tokens.css.`);
  } catch (err) {
    console.error(err);
    showToast(`Promote failed: ${(err as Error).message}`);
  }
}

function togglePicker(force?: boolean): void {
  const next = force ?? !picker.isEnabled();
  picker.setEnabled(next);
  pickerToggle.setAttribute("aria-checked", String(next));
  iframe.contentDocument?.body.classList.toggle("od-picker-on", next);
}

function toggleTweaksPanel(force?: boolean): void {
  const next = force ?? tweaksPanel.hidden;
  tweaksPanel.hidden = !next;
  tweaksToggle.setAttribute("aria-checked", String(next));
  savePanelOpen(next);
}

function onCopy(prompt: string): void {
  const selections = picker.getSelections();
  if (selections.length === 0 || !activeVariant) return;
  let ctx: PayloadContext | null = null;
  if (mode === "designs" && activeDesign) {
    ctx = {
      mode: "designs",
      name: activeDesign.name,
      pageId: activePage?.id,
      variantId: activeVariant.id,
      designSystem: activeDesign.designSystem,
    };
  } else if (mode === "design-systems" && activeDS) {
    ctx = {
      mode: "design-systems",
      name: activeDS.name,
      pageId: activePage?.id,
      variantId: activeVariant.id,
    };
  }
  if (!ctx) return;
  const payload = buildPayload({ ctx, selections, prompt, activeTweaks: tweakValues });
  navigator.clipboard
    .writeText(payload)
    .then(() => {
      showToast(`Copied ${selections.length} element${selections.length === 1 ? "" : "s"} – paste into Claude Code.`);
      picker.clearAll();
      composerInput.value = "";
    })
    .catch(() => showToast("Clipboard blocked – select the text and copy manually."));
}

function showEmpty(): void {
  iframe.hidden = true;
  if (mode === "designs") {
    emptyState.hidden = false;
    emptyStateDs.hidden = true;
    projectLabel.textContent = "0 designs";
  } else {
    emptyState.hidden = true;
    emptyStateDs.hidden = false;
    projectLabel.textContent = "0 design systems";
  }
  activeDesign = null;
  activeDS = null;
  activePage = null;
  activeVariant = null;
  clearPageHistory();
  picker.setEnabled(false);
  document.body.classList.add("no-drafts");
}

// Tweaks panel drag ---------------------------------------------------------

function loadCorner(): Corner {
  try {
    const raw = localStorage.getItem(TWEAKS_CORNER_KEY);
    if (raw && (CORNERS as string[]).includes(raw)) return raw as Corner;
  } catch {
    /* ignore */
  }
  return "br";
}

function saveCorner(c: Corner): void {
  try {
    localStorage.setItem(TWEAKS_CORNER_KEY, c);
  } catch {
    /* ignore */
  }
}

function applyCorner(corner: Corner): void {
  for (const c of CORNERS) tweaksPanel.classList.remove(`corner-${c}`);
  tweaksPanel.classList.add(`corner-${corner}`);
}

function wirePanelDrag(): void {
  const header = tweaksPanel.querySelector("header") as HTMLElement | null;
  if (!header) return;

  let startX = 0;
  let startY = 0;
  let dragging = false;

  header.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("#tweaks-close")) return;
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    header.setPointerCapture(e.pointerId);
    tweaksPanel.classList.add("dragging");
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    tweaksPanel.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);

    const prevRect = tweaksPanel.getBoundingClientRect();
    const centerX = prevRect.left + prevRect.width / 2;
    const centerY = prevRect.top + prevRect.height / 2;
    const isLeft = centerX < window.innerWidth / 2;
    const isTop = centerY < window.innerHeight / 2;
    const next: Corner = `${isTop ? "t" : "b"}${isLeft ? "l" : "r"}` as Corner;

    tweaksPanel.style.transform = "";
    applyCorner(next);
    const newRect = tweaksPanel.getBoundingClientRect();
    const deltaX = prevRect.left - newRect.left;
    const deltaY = prevRect.top - newRect.top;

    tweaksPanel.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    void tweaksPanel.offsetWidth;

    tweaksPanel.classList.remove("dragging");
    tweaksPanel.style.transform = "";
    saveCorner(next);
  };

  header.addEventListener("pointerup", end);
  header.addEventListener("pointercancel", end);
}

// Toast ---------------------------------------------------------------------

let toastTimer: number | null = null;
function showToast(message: string): void {
  const root = document.getElementById("toast-root");
  if (!root) return;
  let toast = root.querySelector(".od-toast") as HTMLElement | null;
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "od-toast";
    root.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove("visible"), 2200);
}
