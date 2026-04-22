import { buildPayload } from "./clipboard";
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
  DraftEntry,
  DraftIndex,
  LegacyChosen,
  NormalizedIndex,
  Page,
  ProjectEntry,
  Tweak,
} from "./types";

const DATA_ROOT = "/data";
const ACTIVE_DESIGN_KEY = "od:active-design";
const TWEAKS_CORNER_KEY = "od:tweaks-corner";
type Corner = "br" | "bl" | "tr" | "tl";
const CORNERS: Corner[] = ["br", "bl", "tr", "tl"];

// Normalized project representation. All render code reads from this; the
// raw DraftIndex (with its union-typed `chosen`) never leaks past
// `normalizeIndex`. `pages` and `chosen` are mirrored at the top level for
// ergonomic access.
interface NormalizedProject {
  project: string;
  index: NormalizedIndex;
  pages: Page[];
  chosen?: Chosen;
}

function getChosenForPage(proj: NormalizedProject | null, pageId: string | null | undefined): ChosenPage | undefined {
  if (!proj || !pageId) return undefined;
  return proj.chosen?.pages?.[pageId];
}

function clearPageHistory(): void {
  pageHistory.length = 0;
  renderBackButton();
}

// Pick the first matching item from a list, tried in the order of candidate
// ids; falls back to items[0]. Used for resolving "which page/variant" with
// a graceful-degradation chain (e.g. prev id → stored id → first).
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
let projects: NormalizedProject[] = [];
let activeProject: NormalizedProject | null = null;
let activePage: Page | null = null;
let activeVariant: DraftEntry | null = null;
let tweakValues: Record<string, string> = {};
const pageHistory: Array<{ pageId: string; variantId: string }> = [];
// Flow navigations (in-draft link clicks, Back button) pass fade: true.
// Everything else – dropdowns, initial load, HMR reload, variant swaps –
// omits it and the iframe swaps without fading.
interface NavOpts { fade?: boolean }

// DOM refs ------------------------------------------------------------------

const iframe = document.getElementById("draft-frame") as HTMLIFrameElement;
const stage = document.getElementById("stage")!;
const emptyState = document.getElementById("empty-state")!;
const projectLabel = document.getElementById("project-label")!;
const designSelect = document.getElementById("design-select") as HTMLSelectElement;
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
pageSelect.addEventListener("change", () => {
  if (!activeProject) return;
  const next = activeProject.pages.find((p) => p.id === pageSelect.value);
  if (!next) return;
  // Explicit dropdown navigation is not a flow – clear history.
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
  // Shift+Comma produces "<" on US layouts, so match e.code.
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
    if (path.endsWith("/index.json")) {
      refresh();
      return;
    }
    if (!activeProject || !activeVariant) return;
    // Variant.file carries the page subfolder today (e.g. "log/01-default.html"),
    // so this URL builder works. If a future schema ever stores file names
    // without the page prefix, update this to join page.id + variant.file.
    const activeUrl = `/drafts/${activeProject.project}/${activeVariant.file}`;
    if (path === activeUrl) {
      reloadActiveVariant();
    }
  });
}

// Normalize -----------------------------------------------------------------

// Convert a raw index.json into the new pages-based shape. Legacy designs
// with a flat `drafts: []` become a single implicit page ("main").
function normalizeIndex(raw: DraftIndex): { index: NormalizedIndex; pages: Page[]; chosen?: Chosen } {
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
      // Legacy single-variant chosen – fold into first page.
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

  // Drop chosen entries whose page was deleted, or whose variantId is no
  // longer on the page. Prevents dangling ★ markers and silent fallbacks.
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

  // Build the narrowed index: drop the legacy `drafts` field and replace the
  // union-typed `chosen` with the filtered new-shape one. After this, no
  // render code needs to discriminate between legacy and new shapes.
  const { drafts: _drafts, chosen: _chosen, ...rest } = raw;
  const index: NormalizedIndex = { ...rest, pages };
  if (chosen) index.chosen = chosen;

  return { index, pages, chosen };
}

// Actions -------------------------------------------------------------------

async function refresh(): Promise<void> {
  const prevProjectName = activeProject?.project;
  const prevPageId = activePage?.id;
  const prevVariantId = activeVariant?.id;

  const raw = await loadProjects();
  projects = raw.map((r) => {
    const norm = normalizeIndex(r.index);
    return { project: r.project, index: norm.index, pages: norm.pages, chosen: norm.chosen };
  });

  if (projects.length === 0) {
    showEmpty();
    return;
  }
  emptyState.hidden = true;
  iframe.hidden = false;

  const storedDesign = loadActiveDesign();
  const proj =
    projects.find((p) => p.project === prevProjectName) ??
    projects.find((p) => p.project === storedDesign) ??
    projects[0];
  activeProject = proj;
  document.body.classList.toggle("no-multi-design", projects.length < 2);
  populateDesignSelect();

  if (proj.pages.length === 0) {
    showEmpty();
    return;
  }

  // Pick active page: previous if still present, else stored, else first.
  const page = resolveById(proj.pages, prevPageId, loadActivePage(proj.project));
  if (!page) {
    showEmpty();
    return;
  }

  // Keep the requested variant if it still exists on the target page.
  selectPage(page, { variantId: prevVariantId });
}

function selectDesign(name: string): void {
  const next = projects.find((p) => p.project === name);
  if (!next) return;
  activeProject = next;
  saveActiveDesign(name);
  populateDesignSelect();
  clearPageHistory();
  if (next.pages.length === 0) {
    showEmpty();
    return;
  }
  const page = resolveById(next.pages, loadActivePage(next.project));
  if (!page) {
    showEmpty();
    return;
  }
  selectPage(page);
}

function selectPage(
  page: Page,
  opts: NavOpts & { variantId?: string | null } = {},
): void {
  if (!activeProject) return;
  activePage = page;
  saveActivePage(activeProject.project, page.id);
  populatePageSelect();

  const variant = resolveById(
    page.variants,
    opts.variantId,
    loadActiveVariant(activeProject.project, page.id),
  );
  if (!variant) {
    showEmpty();
    return;
  }
  selectVariant(variant, { fade: opts.fade });
}

function selectVariant(variant: DraftEntry, opts: NavOpts = {}): void {
  if (!activeProject || !activePage) return;
  activeVariant = variant;
  saveActiveVariant(activeProject.project, activePage.id, variant.id);
  document.body.classList.remove("no-drafts");

  const tweaks = collectTweaks(activeProject.index, activePage, variant);
  const stored = loadStoredValues(activeProject.project, activePage.id, variant.id);
  tweakValues = buildInitialValues(tweaks, stored);

  projectLabel.textContent = `${activeProject.project} · ${activePage.label ?? activePage.id} · ${variant.label ?? variant.id}`;

  const doFade = opts.fade ?? false;
  if (doFade) {
    iframe.classList.add("fading");
  }

  iframe.src = `${DATA_ROOT}/drafts/${activeProject.project}/${variant.file}`;
  picker.clearAll();

  iframe.onload = () => {
    normalizeIframeLayout(iframe);
    injectNavScript(iframe);
    picker.attach(iframe);
    if (picker.isEnabled()) {
      iframe.contentDocument?.body.classList.add("od-picker-on");
    }
    iframe.contentDocument?.addEventListener("keydown", handleHotkey, true);
    applyTweaksToIframe(iframe, tweaks, tweakValues);
    syncIframeBackground(iframe);
    renderPanel();
    // Next paint: fade back in.
    if (doFade) {
      requestAnimationFrame(() => iframe.classList.remove("fading"));
    }
  };
}

function reloadActiveVariant(): void {
  if (!activeVariant) return;
  selectVariant(activeVariant);
}

function collectTweaks(index: NormalizedIndex, page: Page, variant: DraftEntry): Tweak[] {
  return [
    ...(index.tweaks ?? []),
    ...(page.tweaks ?? []),
    ...(variant.tweaks ?? []),
  ];
}

// Ensure draft html + body fill the iframe viewport. Without this, any draft
// whose content is shorter than the stage shows the iframe's white background
// in the leftover space, which reads as a layout bug on dark drafts.
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

  // Default scrollbar look: thin, semi-transparent, no layout shift when the
  // bar appears. Prepended so drafts can override by declaring their own
  // rules later in <head>.
  if (!doc.getElementById("od-viewer-scrollbar-defaults")) {
    const sb = doc.createElement("style");
    sb.id = "od-viewer-scrollbar-defaults";
    sb.textContent = SCROLLBAR_DEFAULTS_CSS;
    doc.head.prepend(sb);
  }
}

// Match the iframe element's background to the draft's own background so the
// reserved scrollbar-gutter column (and any area outside body) blends in
// instead of showing the iframe's fallback white. Called after every tweak
// application since tweaks can change the resolved bg color.
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

// Inject a click listener for [data-od-link] into the draft document. The
// listener posts a navigation message up to the parent viewer.
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
    var link = e.target.closest('[data-od-link]');
    if (!link) return;
    e.preventDefault();
    var spec = link.getAttribute('data-od-link') || '';
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
  // Ignore messages that arrive before the first draft is fully wired (e.g.
  // a residual click handler from a prior document firing during iframe swap).
  if (!activeProject || !activePage || !activeVariant) {
    console.warn("[od] navigate message dropped – viewer not ready", data);
    return;
  }

  const targetPageId = String(data.pageId || "");
  const targetVariantId = data.variantId ? String(data.variantId) : null;
  const next = activeProject.pages.find((p) => p.id === targetPageId);
  if (!next) {
    showToast(`No page "${targetPageId}" in this design.`);
    return;
  }

  // Fullscreen persists across in-draft navigation by design – the user is
  // walking through a flow and shouldn't be yanked out of fullscreen on every
  // hop. Escape (or the fullscreen button) exits when they're done.
  pageHistory.push({ pageId: activePage.id, variantId: activeVariant.id });
  renderBackButton();
  selectPage(next, { variantId: targetVariantId, fade: true });
}

function goBack(): void {
  const prev = pageHistory.pop();
  renderBackButton();
  if (!prev || !activeProject) return;
  const page = activeProject.pages.find((p) => p.id === prev.pageId);
  if (!page) return;
  selectPage(page, { variantId: prev.variantId, fade: true });
}

function renderBackButton(): void {
  backBtn.hidden = pageHistory.length === 0;
}

// Selectors -----------------------------------------------------------------

function populateDesignSelect(): void {
  if (!activeProject) return;
  designSelect.innerHTML = "";
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.project;
    opt.textContent = hasAnyChosen(p.chosen) ? `★ ${p.project}` : p.project;
    if (p.project === activeProject.project) opt.selected = true;
    designSelect.appendChild(opt);
  }
}

function populatePageSelect(): void {
  if (!activeProject || !activePage) return;
  pageSelect.innerHTML = "";
  for (const p of activeProject.pages) {
    const opt = document.createElement("option");
    opt.value = p.id;
    const starred = getChosenForPage(activeProject, p.id) ? "★ " : "";
    opt.textContent = `${starred}${p.label ?? p.id}`;
    if (p.id === activePage.id) opt.selected = true;
    pageSelect.appendChild(opt);
  }
  document.body.classList.toggle("no-multi-page", activeProject.pages.length < 2);
}

function hasAnyChosen(chosen: Chosen | undefined): boolean {
  if (!chosen || !chosen.pages) return false;
  return Object.keys(chosen.pages).length > 0;
}

// localStorage keys ---------------------------------------------------------
//
// All dynamic segments are URL-encoded before concatenation so an ID
// containing a colon can't alias across keys (e.g. design "a:b" + page "c"
// must not collide with design "a" + page "b:c").

function encKey(...parts: string[]): string {
  return parts.map((p) => encodeURIComponent(p)).join(":");
}

function loadActiveDesign(): string | null {
  try { return localStorage.getItem(ACTIVE_DESIGN_KEY); } catch { return null; }
}
function saveActiveDesign(name: string): void {
  try { localStorage.setItem(ACTIVE_DESIGN_KEY, name); } catch { /* ignore */ }
}
function loadActivePage(design: string): string | null {
  try { return localStorage.getItem(`od:active-page:${encodeURIComponent(design)}`); } catch { return null; }
}
function saveActivePage(design: string, pageId: string): void {
  try { localStorage.setItem(`od:active-page:${encodeURIComponent(design)}`, pageId); } catch { /* ignore */ }
}
function loadActiveVariant(design: string, pageId: string): string | null {
  try { return localStorage.getItem(`od:active-variant:${encKey(design, pageId)}`); } catch { return null; }
}
function saveActiveVariant(design: string, pageId: string, variantId: string): void {
  try { localStorage.setItem(`od:active-variant:${encKey(design, pageId)}`, variantId); } catch { /* ignore */ }
}

// Panel ---------------------------------------------------------------------

function renderPanel(): void {
  if (!activeProject || !activePage || !activeVariant) return;
  const tweaks = collectTweaks(activeProject.index, activePage, activeVariant);
  const variants = activePage.variants.map((v) => ({ id: v.id, label: v.label ?? v.id }));
  const chosenForPage = getChosenForPage(activeProject, activePage.id);

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
      saveStoredValues(
        activeProject!.project,
        activePage!.id,
        activeVariant!.id,
        tweakValues,
      );
      applyTweaksToIframe(iframe, tweaks, tweakValues);
      syncIframeBackground(iframe);
    },
    chosenVariantId: chosenForPage?.variantId,
    pageLabel: activePage.label ?? activePage.id,
    showFinalizeAll: activeProject.pages.length > 1,
    onFinalize: () => finalizePage(),
    onFinalizeAll: () => finalizeAllPages(),
    onClearChosen: () => clearChosenPage(),
  });
  renderChosenPill();
  renderBackButton();
  // Ensure the chosen marker in the page select reflects current state.
  populatePageSelect();
}

function renderChosenPill(): void {
  let pill = document.getElementById("chosen-pill");
  const chosenForPage = getChosenForPage(activeProject, activePage?.id);
  const show =
    activeProject &&
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
  if (!activeProject || !activePage || !activeVariant) return;
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
  if (!activeProject) return;
  const allPages: Record<string, ChosenPage> = {};
  for (const page of activeProject.pages) {
    const variantId = loadActiveVariant(activeProject.project, page.id)
      ?? page.variants[0]?.id;
    if (!variantId) continue;
    const stored = loadStoredValues(activeProject.project, page.id, variantId);
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
  if (!activeProject || !activePage) return;
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
  if (!activeProject) throw new Error("no active project");
  const r = await fetch(`${DATA_ROOT}/drafts/${activeProject.project}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function applyChosenResponse(res: { chosen: Chosen | null }): void {
  if (!activeProject) return;
  if (res.chosen) {
    activeProject.chosen = res.chosen;
    activeProject.index.chosen = res.chosen;
  } else {
    activeProject.chosen = undefined;
    delete activeProject.index.chosen;
  }
  populateDesignSelect();
  populatePageSelect();
  renderPanel();
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
  if (selections.length === 0 || !activeVariant || !activeProject) return;
  const payload = buildPayload({
    project: activeProject.project,
    file: activeVariant.file,
    selections,
    prompt,
    activeTweaks: tweakValues,
  });
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
  emptyState.hidden = false;
  projectLabel.textContent = "0 drafts";
  activeProject = null;
  activePage = null;
  activeVariant = null;
  clearPageHistory();
  picker.setEnabled(false);
  document.body.classList.add("no-drafts");
}

// Data loading --------------------------------------------------------------

async function loadProjects(): Promise<ProjectEntry[]> {
  const out: ProjectEntry[] = [];
  try {
    const rootIndexRes = await fetch(`${DATA_ROOT}/drafts/index.json`);
    if (rootIndexRes.ok) {
      const rootIndex = (await rootIndexRes.json()) as { projects: string[] };
      if (Array.isArray(rootIndex.projects)) {
        for (const project of rootIndex.projects) {
          const r = await fetch(`${DATA_ROOT}/drafts/${project}/index.json`);
          if (r.ok) out.push({ project, index: (await r.json()) as DraftIndex });
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load project index:", err);
  }
  return out;
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
