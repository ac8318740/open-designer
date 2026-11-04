import { buildPayload, type PayloadContext } from "./clipboard";
import { mountComposer } from "./composer";
import { MAX_SELECTIONS, Picker } from "./picker";
import {
  buildInitialValues,
  isPanelOpen,
  loadStoredValues,
  renderTweaksPanel,
  savePanelOpen,
  saveStoredValues,
  tweakPayload,
} from "./tweaks";
import { BridgeHost } from "./bridge/host";
import type { FrameMessage, Restore, TokenSheet } from "./bridge/protocol";
import type {
  Approvals,
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
  Surface,
  SyncDivergence,
  TokensMap,
  Tweak,
  VariantEntry,
  ViewerMode,
} from "./types";
import {
  approvalKey,
  computeDivergence,
  loadApprovals,
  lookupApproval,
} from "./approvals";
import {
  collectSurfaceTweaks,
  partitionByType,
  resolveSurfaceState,
} from "./surface-state";
import { computeTokenDivergences, loadTokensMap } from "./token-sync";
import { buildPromotePrompt } from "./sync-prompts";
// Canonical preview chrome – sent to preview/*.html frames so every
// DS's token demo cards share the same clean devtool look. Swatches still
// pull their colours from each DS's tokens.css, but the layout/typography
// of the preview itself lives here in the viewer.
import PREVIEW_CHROME_CSS from "./preview-chrome.css?raw";

const DATA_ROOT = "/data";
// The launcher injects a per-launch token; every write must send it back.
const WRITE_HEADERS = {
  "content-type": "application/json",
  "x-od-token": document.querySelector<HTMLMetaElement>('meta[name="od-write-token"]')?.content ?? "",
};
const ACTIVE_DESIGN_KEY = "od:active-design";
const ACTIVE_DS_KEY = "od:active-ds";
const ACTIVE_MODE_KEY = "od:mode";
const TWEAKS_CORNER_KEY = "od:tweaks-corner";
const SYNC_CORNER_KEY = "od:sync-corner";
type Corner = "br" | "bl" | "tr" | "tl";
const CORNERS: Corner[] = ["br", "bl", "tr", "tl"];

// Timing knobs, kept together so tuning doesn't hunt across the file.
const DIVERGENCE_DEBOUNCE_MS = 100;
const SYNC_RECOMPUTE_DEBOUNCE_MS = 100;
const SNAPSHOT_WAIT_MS = 300;
const TOAST_VISIBLE_MS = 2200;

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
  surfaces: Surface[];
  approvals: Approvals;
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
// Tweak IDs the user has explicitly edited for the active variant. Seeded
// from stored values on variant load so reloads preserve "touched" state.
// Used by the sync panel to suppress phantom divergences for tweaks that
// have no declared default and haven't been touched – the fallback value
// (#000000 for color, min for slider) isn't a real comparison point.
let touchedTweakIds: Set<string> = new Set();
let divergence = false;
let divergenceTimer: number | null = null;
let tokensMap: TokensMap = new Map();
let syncDivergences: SyncDivergence[] = [];
// Key of the surface the user has dismissed the sync panel for this visit.
// Cleared on surface change; × therefore hides for this visit only.
let syncDismissedKey: string | null = null;
const lastDotState = new Map<string, string>(); // surfaceKey -> "green"|"yellow"|""
const pageHistory: Array<{ pageId: string; variantId: string }> = [];
// `reload` forces the iframe to re-fetch even when the URL is unchanged.
// Used by the refresh button and hot reload; navigation leaves it unset so
// the same-document short-circuit in selectVariant still avoids flicker.
interface NavOpts { fade?: boolean; reload?: boolean }
// The frame document the host is loading or showing. `restore` is what the
// next `init` hands back after a reload of the same URL.
interface FrameLoad {
  url: string;
  tweaks: Tweak[];
  restore?: Restore;
  sheets: Promise<TokenSheet[]>;
  stateWarned?: boolean;
}
let currentLoad: FrameLoad | null = null;
// Last scroll offset the frame reported, kept for a reload of the same URL.
let lastScroll: { url: string; x: number; y: number } | null = null;
// Bumped on every selectVariant so a late snapshot can't start a stale load.
let navSeq = 0;
// Combos the frame forwards; each maps to one named host action.
const FRAME_KEYS: Record<string, () => void> = {
  "mod+shift+k": () => togglePicker(),
  "mod+shift+comma": () => toggleTweaksPanel(),
  escape: () => {
    if (document.body.classList.contains("fullscreen-mode")) exitFullscreen();
  },
};

// DOM refs ------------------------------------------------------------------

const iframe = document.getElementById("draft-frame") as HTMLIFrameElement;
const stage = document.getElementById("stage")!;
const emptyState = document.getElementById("empty-state")!;
const emptyStateDs = document.getElementById("empty-state-ds")!;
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
const approveBtn = document.getElementById("approve-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const pageSelectCaption = document.getElementById("page-select-caption") as HTMLElement;
const tweaksPanel = document.getElementById("tweaks-panel") as HTMLElement;
const tweaksBody = document.getElementById("tweaks-body")!;
const tweaksClose = document.getElementById("tweaks-close") as HTMLButtonElement;
const syncPanel = document.getElementById("sync-panel") as HTMLElement;
const syncSubtitle = document.getElementById("sync-subtitle") as HTMLElement;
const syncList = document.getElementById("sync-list") as HTMLElement;
const syncClose = document.getElementById("sync-close") as HTMLButtonElement;
const syncResetBtn = document.getElementById("sync-reset-btn") as HTMLButtonElement;
const syncPromoteBtn = document.getElementById("sync-promote-btn") as HTMLButtonElement;
const composerRoot = document.getElementById("composer") as HTMLElement;
const composerChips = document.getElementById("composer-chips")!;
const composerInput = document.getElementById("composer-input") as HTMLTextAreaElement;
const composerCopy = document.getElementById("composer-copy") as HTMLButtonElement;
const composerClear = document.getElementById("composer-clear") as HTMLButtonElement;

const bridge = new BridgeHost({
  frame: iframe,
  onMessage: onFrameMessage,
  onClosed: () => {
    iframe.classList.remove("fading");
    showToast("This example navigated away and was stopped.");
  },
  onVersionMismatch: () => {
    iframe.classList.remove("fading");
    showToast("This example was built for a different OpenDesigner version; rebuild it");
  },
});

// Bootstrap -----------------------------------------------------------------

const renderComposer = mountComposer({
  root: composerRoot,
  chipsRoot: composerChips,
  input: composerInput,
  copyBtn: composerCopy,
  clearBtn: composerClear,
  getSelections: () => picker.getSelections(),
  onRemove: (id) => {
    picker.removeById(id);
    bridge.send("selection-remove", { id });
  },
  onClear: () => clearSelections(),
  onCopy: (prompt) => onCopy(prompt),
});

picker.onChange((selections) => {
  renderComposer(selections);
  if (selections.length > 0) composerInput.focus({ preventScroll: true });
});

pickerToggle.addEventListener("click", () => togglePicker());
tweaksToggle.addEventListener("click", () => toggleTweaksPanel());
tweaksClose.addEventListener("click", () => toggleTweaksPanel(false));
syncClose.addEventListener("click", () => dismissSyncPanel());
syncResetBtn.addEventListener("click", () => resetSurfaceToBaseline());
syncPromoteBtn.addEventListener("click", () => copyPromotePrompt());
refreshBtn.addEventListener("click", () => refresh({ reload: true }));
fullscreenBtn.addEventListener("click", () => enterFullscreen());
approveBtn.addEventListener("click", () => approveCurrentSurface());
resetBtn.addEventListener("click", () => resetToSnapshot());
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
window.addEventListener("message", (e) => bridge.receive(e));

mode = loadMode();
applyModeToDom();

const panelStartsOpen = isPanelOpen();
tweaksPanel.hidden = !panelStartsOpen;
tweaksToggle.setAttribute("aria-checked", String(panelStartsOpen));
pickerToggle.setAttribute("aria-checked", "false");
applyCorner(tweaksPanel, loadCorner(TWEAKS_CORNER_KEY, "br"));
applyCorner(syncPanel, loadCorner(SYNC_CORNER_KEY, "bl"));
wirePanelDrag(tweaksPanel, TWEAKS_CORNER_KEY);
wirePanelDrag(syncPanel, SYNC_CORNER_KEY);

refresh().catch((err) => {
  console.error(err);
  showEmpty();
});

// Hot reload ----------------------------------------------------------------
//
// One save produces a burst of watcher events: a rename-replace write emits
// several for the temp file and the target, and the server debounces per
// path, not per burst. Coalesce them so the iframe swaps once. The cap keeps
// a sustained write stream (e.g. a build step) from postponing the reload
// forever.
const HOT_RELOAD_COALESCE_MS = 100;
const HOT_RELOAD_MAX_WAIT_MS = 500;
let hotReloadTimer: number | null = null;
let hotReloadFirstEventAt = 0;
let hotReloadNeedsRefresh = false;
let hotReloadTokensChanged = false;

function onDataChanged(path: string): void {
  // Index and manifest files anywhere can add or remove entries in the
  // header dropdowns, so they always trigger a full refresh and reload.
  const isIndex = path.endsWith("/index.json") || path.endsWith("/manifest.json");
  // A tokens.css edit refreshes the data and resends `tokens` without
  // reloading the frame.
  const isTokens = path.endsWith("/tokens.css");
  // Anything else only matters if the active surface can link it – its own
  // directory, or a DS in its extends chain (fonts, shared CSS, images).
  if (!isIndex && !isTokens && !activeDataDirs().some((dir) => path.startsWith(dir))) return;
  if (isIndex) hotReloadNeedsRefresh = true;
  if (isTokens) hotReloadTokensChanged = true;
  const now = Date.now();
  if (hotReloadTimer === null) {
    hotReloadFirstEventAt = now;
  } else {
    window.clearTimeout(hotReloadTimer);
  }
  const remaining = Math.max(0, hotReloadFirstEventAt + HOT_RELOAD_MAX_WAIT_MS - now);
  hotReloadTimer = window.setTimeout(flushHotReload, Math.min(HOT_RELOAD_COALESCE_MS, remaining));
}

function flushHotReload(): void {
  hotReloadTimer = null;
  const needsRefresh = hotReloadNeedsRefresh;
  const tokensChanged = hotReloadTokensChanged;
  hotReloadNeedsRefresh = false;
  hotReloadTokensChanged = false;
  if (needsRefresh || tokensChanged) {
    // Token previews <link> their tokens.css themselves, so only a reload
    // picks up the edit there.
    const reload = needsRefresh || previewSurfaceActive();
    refresh({ reload }).catch((err) => console.error(err));
  } else {
    reloadActiveVariant();
  }
}

// Data-root-relative directory prefixes (matching the SSE payload shape)
// whose files the active surface may link.
function activeDataDirs(): string[] {
  if (mode === "designs" && activeDesign) {
    return [
      `/designs/${activeDesign.name}/`,
      ...resolveExtendsChain(activeDesign.designSystem).map((ds) => `/design-systems/${ds.name}/`),
    ];
  }
  if (mode === "design-systems" && activeDS) {
    return resolveExtendsChain(activeDS.name).map((ds) => `/design-systems/${ds.name}/`);
  }
  return [];
}

// `import.meta.hot` is truthy only under `vite dev`; in the shipped bundle
// that branch is dead-code-eliminated and SSE from the launcher
// drives the reload instead. Event name + payload shape match across both
// transports.
if (import.meta.hot) {
  import.meta.hot.on("open-designer:data-changed", (payload: { path: string }) => {
    onDataChanged(payload.path);
  });
} else if (typeof EventSource !== "undefined") {
  const source = new EventSource("/__od/events");
  source.addEventListener("data-changed", (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as { path: string };
      onDataChanged(payload.path);
    } catch {
      /* ignore malformed payload */
    }
  });
  // EventSource auto-reconnects on error – no manual retry needed.
}

// Active context helpers ----------------------------------------------------

function activeContext(): { pages: Page[] } | null {
  if (mode === "designs") return activeDesign;
  return activeDS;
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
      filtered[pageId] = migrateChosenStateSplit(page, entry);
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

// V1→V2 migration: legacy designs stored state values in `chosen.tweaks`
// alongside designer decisions. The new shape splits them into a sibling
// `state` map. Walk the page's tweak schema, move any value whose tweak is
// declared `type: "state"` into a fresh `state` map, and strip from `tweaks`.
// The migration is in-memory; it persists to disk on the next finalize POST.
function migrateChosenStateSplit(page: Page, entry: ChosenPage): ChosenPage {
  const tweakTypes = new Map<string, string>();
  // First option of each state tweak – used to rewrite the legacy "" sentinel
  // (the old "unfiltered – stacked" value) into a real state value.
  const stateFirstOption = new Map<string, string>();
  const recordTweak = (t: Tweak): void => {
    tweakTypes.set(t.id, t.type);
    if (t.type === "state") {
      const first = t.options?.[0];
      if (first !== undefined) {
        stateFirstOption.set(t.id, typeof first === "string" ? first : first.value);
      }
    }
  };
  for (const t of page.tweaks ?? []) recordTweak(t);
  for (const v of page.variants) for (const t of v.tweaks ?? []) recordTweak(t);
  const tweaks: Record<string, string> = {};
  const state: Record<string, string> = { ...(entry.state ?? {}) };
  let migrated = false;
  for (const [k, v] of Object.entries(entry.tweaks ?? {})) {
    if (tweakTypes.get(k) === "state") {
      state[k] = v;
      migrated = true;
    } else {
      tweaks[k] = v;
    }
  }
  for (const [k, v] of Object.entries(state)) {
    if (v !== "") continue;
    const replacement = stateFirstOption.get(k);
    if (replacement === undefined) {
      delete state[k];
    } else {
      state[k] = replacement;
    }
    migrated = true;
  }
  if (!migrated && !entry.state) return entry;
  return {
    ...entry,
    tweaks,
    ...(Object.keys(state).length > 0 ? { state } : {}),
  };
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
  clearSelections();
  // Refresh picks up the active design/DS for the new mode. The flash-mask
  // (fading class) is applied right before iframe.src changes in
  // selectVariant, not here – keeping the old iframe visible during the
  // fetch + parse work makes the transition feel snappy instead of
  // lingering on a blank frame.
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
  pageSelectCaption.textContent = mode === "design-systems" ? "Surface" : "Page";
  if (mode !== "design-systems") {
    syncPanel.hidden = true;
    syncDivergences = [];
  }
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
      const j = (await r.json()) as {
        designs?: string[];
        projects?: string[];
        _warnings?: string[];
      };
      const names = j.designs ?? j.projects ?? [];
      // Schema warnings are warn-don't-fail this release. They surface as
      // console output here; next release will upgrade to a hard error.
      for (const w of j._warnings ?? []) console.warn(`[od] schema: ${w}`);
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

// Captured alongside the DS list so the active-DS fallback chain can use it
// when nothing else picks a DS. Reset to null when the launcher returns no
// config; callers must tolerate a stale default that no longer exists.
let configDefaultDesignSystem: string | null = null;

async function loadDesignSystems(): Promise<NormalizedDS[]> {
  const out: NormalizedDS[] = [];
  try {
    const r = await fetch(`${DATA_ROOT}/design-systems/index.json`);
    if (r.ok) {
      const j = (await r.json()) as {
        designSystems?: Array<{ name: string }>;
        defaultDesignSystem?: string | null;
      };
      configDefaultDesignSystem = j.defaultDesignSystem ?? null;
      const list = j.designSystems ?? [];
      for (const entry of list) {
        const name = entry.name;
        const [manifestRes, pagesRes, previewRes, approvals] = await Promise.all([
          fetch(`${DATA_ROOT}/design-systems/${name}/manifest.json`),
          fetch(`${DATA_ROOT}/design-systems/${name}/pages/index.json`),
          fetch(`${DATA_ROOT}/design-systems/${name}/preview/index.json`),
          loadApprovals(name),
        ]);
        if (!manifestRes.ok) continue;
        const manifest = (await manifestRes.json()) as DesignSystemManifest;
        let pages: Page[] = [];
        if (pagesRes.ok) {
          const pj = (await pagesRes.json()) as DesignSystemIndexPages;
          pages = normalizeDSPages(pj);
        }
        interface PreviewEntry {
          id: string;
          label: string;
          file: string;
          tweaks?: Tweak[];
          variants?: VariantEntry[];
        }
        let previews: PreviewEntry[] = [];
        if (previewRes.ok) {
          const pj = (await previewRes.json()) as { previews?: PreviewEntry[] };
          previews = pj.previews ?? [];
        }
        const surfaces: Surface[] = [
          ...pages.map((p) => ({
            kind: "page" as const,
            id: p.id,
            label: p.label ?? p.id,
            variants: p.variants,
            tweaks: p.tweaks,
          })),
          ...previews.map((pv) => ({
            kind: "tokens" as const,
            id: pv.id,
            label: pv.label,
            // Synthesize a single default variant when none authored, so the
            // existing page/variant plumbing works unchanged.
            variants:
              Array.isArray(pv.variants) && pv.variants.length > 0
                ? pv.variants
                : [{ id: "01-default", file: pv.file, label: "Default" }],
            file: pv.file,
            tweaks: pv.tweaks,
          })),
        ];
        out.push({ name, manifest, pages: dsSurfacesToPages(surfaces), surfaces, approvals });
      }
    }
  } catch (err) {
    console.warn("Failed to load design systems:", err);
  }
  return out;
}

// `surfaces` is the source of truth – kind, file, and authored tweaks live
// there. `pages` is a derived projection used so the existing page/variant
// plumbing (back nav, storage keys, tweaks panel) works unchanged for
// tokens-kind surfaces too. Tokens surfaces may carry authored variants and
// tweaks from preview/index.json; when they don't, loadDesignSystems
// synthesizes a single default variant. De-duplication of the two lists is
// out of scope for now.
function dsSurfacesToPages(surfaces: Surface[]): Page[] {
  return surfaces.map((s) => ({
    id: s.id,
    label: s.label,
    tweaks: s.tweaks,
    variants: s.variants,
  }));
}

function surfaceOf(ds: NormalizedDS | null, pageId: string | null | undefined): Surface | undefined {
  if (!ds || !pageId) return undefined;
  return ds.surfaces.find((s) => s.id === pageId);
}

async function refreshTokensMap(): Promise<void> {
  if (mode !== "design-systems" || !activeDS) {
    tokensMap = new Map();
    return;
  }
  const chain = resolveExtendsChain(activeDS.name).map((d) => d.name);
  tokensMap = await loadTokensMap(chain);
  // An empty map after a DS-mode refresh usually means every tokens.css fetch
  // failed. Without a warning, divergence panels silently go green and users
  // think everything matches.
  if (tokensMap.size === 0 && chain.length > 0) {
    console.warn(
      `[od] tokensMap is empty for DS "${activeDS.name}" – tokens.css fetches may have failed. Sync + divergence checks will be inaccurate.`,
    );
  }
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

async function refresh(opts: { reload?: boolean } = {}): Promise<void> {
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
    selectPage(page, { variantId: prevVariantId, reload: opts.reload });
  } else {
    if (designSystems.length === 0) {
      showEmpty();
      return;
    }
    emptyState.hidden = true;
    emptyStateDs.hidden = true;
    iframe.hidden = false;

    const storedName = loadActiveDS();
    // Precedence: previous DS in this session → localStorage → config's
    // defaultDesignSystem → first DS alphabetically. A stale default that
    // doesn't exist in the list falls through to the first.
    let ds =
      designSystems.find((p) => p.name === prevDSName) ??
      designSystems.find((p) => p.name === storedName);
    if (!ds && configDefaultDesignSystem) {
      const named = designSystems.find((p) => p.name === configDefaultDesignSystem);
      if (named) ds = named;
      else
        console.warn(
          `[od] config defaultDesignSystem "${configDefaultDesignSystem}" not found – falling back to "${designSystems[0].name}".`,
        );
    }
    if (!ds) ds = designSystems[0];
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
    await refreshTokensMap();
    selectPage(page, { variantId: prevVariantId, reload: opts.reload });
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
    syncDismissedKey = null;
    if (next.pages.length === 0) {
      showEmpty();
      return;
    }
    const page = resolveById(next.pages, loadActivePage(`ds:${next.name}`));
    if (!page) {
      showEmpty();
      return;
    }
    // Capture the target DS so a rapid re-select doesn't race: if the user
    // swaps DS again before the tokens fetch resolves, skip selectPage so it
    // doesn't compute divergences against a stale tokens map.
    const targetDS = next;
    refreshTokensMap().then(() => {
      if (activeDS === targetDS) selectPage(page);
    });
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
  // Reset dismissal on surface change so a re-visit re-shows the panel.
  if (activePage?.id !== page.id) {
    syncDismissedKey = null;
  }
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
  selectVariant(variant, { fade: opts.fade, reload: opts.reload });
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
  touchedTweakIds = new Set(Object.keys(stored));

  // Compute the target URL. If it matches the iframe's current src, the
  // document is already loaded – assigning it would force Chrome to tear
  // down and re-fetch the same page (300ms+ of black-iframe on localhost),
  // which is exactly the flicker the mode toggle produces when you leave
  // Designs empty and come back to a DS surface that was already visible.
  let nextUrl: string | null = null;
  if (mode === "designs" && activeDesign) {
    nextUrl = `${DATA_ROOT}/designs/${activeDesign.name}/${variant.file}`;
  } else if (mode === "design-systems" && activeDS) {
    const surface = surfaceOf(activeDS, activePage?.id);
    nextUrl =
      surface?.kind === "tokens"
        ? `${DATA_ROOT}/design-systems/${activeDS.name}/preview/${variant.file}`
        : `${DATA_ROOT}/design-systems/${activeDS.name}/pages/${variant.file}`;
  }
  if (!nextUrl) return;

  const url = nextUrl;
  const seq = ++navSeq;
  const sameDoc = iframe.src === new URL(url, window.location.href).href;
  if (sameDoc && !opts.reload && bridge.ready) {
    // Same document, no reload. Resend tokens and tweaks in case they
    // changed and re-render the panel; skip the fade entirely.
    clearSelections();
    if (currentLoad) {
      currentLoad.tweaks = tweaks;
      currentLoad.sheets = tokenSheets();
      currentLoad.sheets.then((sheets) => {
        if (seq === navSeq) bridge.send("tokens", { sheets });
      });
    }
    sendTweaks(tweaks);
    renderPanel();
    return;
  }

  if (!sameDoc || !opts.reload) {
    // Different URL – mask the brief white flash while the frame swaps
    // documents. The mask lifts when the new document reports `applied`.
    clearSelections();
    startLoad(url, tweaks, undefined);
    return;
  }

  // Reloading the same document (refresh button, hot reload) keeps the
  // reader's place: ask the frame for a snapshot, wait at most 300 ms, then
  // reload and hand the state back in `init`. A reload still in flight has
  // no frame to ask, so reuse the state that reload carries.
  const selections = picker.getSelections().map((sel) => sel.selector);
  if (!bridge.ready) {
    startLoad(url, tweaks, currentLoad?.url === url ? currentLoad.restore : undefined);
    return;
  }
  bridge.requestSnapshot(SNAPSHOT_WAIT_MS).then((snap) => {
    if (seq !== navSeq) return;
    const scroll = snap?.scroll ?? (lastScroll?.url === url ? { x: lastScroll.x, y: lastScroll.y } : undefined);
    startLoad(url, tweaks, {
      ...(scroll ? { scroll } : {}),
      ...(snap?.app !== undefined ? { app: snap.app } : {}),
      selections,
    });
  });
}

function startLoad(url: string, tweaks: Tweak[], restore: Restore | undefined): void {
  currentLoad = { url, tweaks, restore, sheets: tokenSheets() };
  if (lastScroll?.url !== url) lastScroll = null;
  iframe.classList.add("fading");
  bridge.load(() => {
    // A blanked frame keeps its srcdoc, which would win over src.
    iframe.removeAttribute("srcdoc");
    iframe.src = url;
  });
  renderPanel();
}

function sendTweaks(tweaks: Tweak[]): void {
  bridge.send("tweaks", { ...tweakPayload(tweaks, tweakValues, tokensMap) });
}

function clearSelections(): void {
  picker.clearAll();
  bridge.send("selection-clear");
}

function previewSurfaceActive(): boolean {
  return mode === "design-systems" && surfaceOf(activeDS, activePage?.id)?.kind === "tokens";
}

// Style sheets the frame prepends to <head>, in order: the viewer's layout
// defaults, the active extends chain's tokens.css (parent→child), and the
// preview chrome on token previews. The design's own file may also <link>
// the tokens for file-open-in-browser compatibility.
async function tokenSheets(): Promise<TokenSheet[]> {
  const sheets: TokenSheet[] = [{ name: "od-viewer", css: VIEWER_DEFAULTS_CSS }];
  if (previewSurfaceActive()) {
    // Preview surfaces already <link> ../tokens.css.
    sheets.push({ name: "od-preview-chrome", css: PREVIEW_CHROME_CSS });
    return sheets;
  }
  const dsName = mode === "designs" ? activeDesign?.designSystem : activeDS?.name;
  const chain = resolveExtendsChain(dsName);
  const texts = await Promise.all(
    chain.map(async (ds) => {
      try {
        const r = await fetch(`${DATA_ROOT}/design-systems/${ds.name}/tokens.css`);
        return r.ok ? await r.text() : null;
      } catch {
        return null;
      }
    }),
  );
  chain.forEach((ds, i) => {
    const css = texts[i];
    if (css !== null) sheets.push({ name: ds.name, css });
  });
  return sheets;
}

function onFrameMessage(msg: FrameMessage): void {
  const load = currentLoad;
  switch (msg.type) {
    case "ready":
      if (!load) return;
      load.sheets.then((sheets) => {
        if (currentLoad !== load) return;
        bridge.init({
          tokens: sheets,
          tweaks: tweakPayload(load.tweaks, tweakValues, tokensMap),
          picker: picker.isEnabled(),
          keys: Object.keys(FRAME_KEYS),
          marks: [],
          ...(load.restore ? { restore: load.restore } : {}),
        });
      });
      return;
    case "applied":
      iframe.style.backgroundColor = msg.background ?? "";
      iframe.classList.remove("fading");
      if (load && !load.stateWarned && !msg.stateRules && load.tweaks.some((t) => t.type === "state")) {
        // The author probably forgot to wire the CSS – a common trip-up that
        // produces a silent "states all stacked even when filtered."
        load.stateWarned = true;
        console.warn(
          "[od] this surface declares a `state` tweak but no `[data-state=...]` selector exists in the variant's stylesheets – switching the dropdown will have no visible effect. See SKILL.md step 8 for the CSS pattern.",
        );
      }
      return;
    case "selection":
      picker.set(msg.items);
      if (msg.limit) showToast(`Limit reached – max ${MAX_SELECTIONS} selections. Remove one to add another.`);
      return;
    case "picker":
      togglePicker(false);
      return;
    case "navigate":
      navigateTo(msg.page, msg.variant ?? null);
      return;
    case "scroll":
      if (load) lastScroll = { url: load.url, x: msg.x, y: msg.y };
      return;
    case "key":
      FRAME_KEYS[msg.combo]?.();
      return;
    case "error":
      showToast(`This example failed to render: ${msg.message}`);
      return;
    default:
      // resize, revealed, and mark-click serve ACStack's host only.
      return;
  }
}

function reloadActiveVariant(): void {
  if (!activeVariant) return;
  selectVariant(activeVariant, { reload: true });
}

function collectTweaks(index: NormalizedIndex | undefined, page: Page, variant: VariantEntry): Tweak[] {
  return [
    ...(index?.tweaks ?? []),
    ...(page.tweaks ?? []),
    ...(variant.tweaks ?? []),
  ];
}

const VIEWER_DEFAULTS_CSS = `
  html, body { min-height: 100vh; }
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

function navigateTo(targetPageId: string, targetVariantId: string | null): void {
  if (!activePage || !activeVariant) {
    console.warn("[od] navigate message dropped – viewer not ready", targetPageId);
    return;
  }
  const ctx = activeContext();
  if (!ctx) return;
  if (targetPageId === activePage.id && (!targetVariantId || targetVariantId === activeVariant.id)) return;
  const next = ctx.pages.find((p) => p.id === targetPageId);
  if (!next) {
    showToast(`No page "${targetPageId}" in this ${mode === "designs" ? "design" : "design system"}.`);
    return;
  }

  pageHistory.push({ pageId: activePage.id, variantId: activeVariant.id });
  renderBackButton();
  selectPage(next, { variantId: targetVariantId });
}

function goBack(): void {
  const prev = pageHistory.pop();
  renderBackButton();
  const ctx = activeContext();
  if (!prev || !ctx) return;
  const page = ctx.pages.find((p) => p.id === prev.pageId);
  if (!page) return;
  selectPage(page, { variantId: prev.variantId });
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

  if (mode === "design-systems" && activeDS) {
    const pageSurfaces = activeDS.surfaces.filter((s) => s.kind === "page");
    const previewSurfaces = activeDS.surfaces.filter((s) => s.kind === "tokens");
    if (pageSurfaces.length) {
      pageSelect.appendChild(buildSurfaceGroup("Pages", pageSurfaces));
    }
    if (previewSurfaces.length) {
      pageSelect.appendChild(buildSurfaceGroup("Tokens", previewSurfaces));
    }
    return;
  }

  for (const p of ctx.pages) {
    const opt = document.createElement("option");
    opt.value = p.id;
    const starred =
      mode === "designs" && getChosenForPage(activeDesign, p.id) ? "★ " : "";
    opt.textContent = `${starred}${p.label ?? p.id}`;
    if (p.id === activePage.id) opt.selected = true;
    pageSelect.appendChild(opt);
  }
}

function buildSurfaceGroup(label: string, surfaces: Surface[]): HTMLOptGroupElement {
  const group = document.createElement("optgroup");
  group.label = label;
  for (const s of surfaces) {
    const opt = document.createElement("option");
    opt.value = s.id;
    const state = dotForSurface(s);
    opt.dataset.dot = state;
    const prefix = state ? "● " : "";
    opt.textContent = `${prefix}${s.label}`;
    if (s.id === activePage?.id) opt.selected = true;
    group.appendChild(opt);
  }
  return group;
}

// Returns the dot state for a surface: "approved" (green), "diverged"
// (yellow), or "" (mode not DS / no data). A never-visited surface with no
// snapshot is *not* diverged – the user hasn't disagreed with anything yet
// and the snapshot's variant pick is the most accurate guess of what they'd
// see on visit.
function dotForSurface(surface: Surface): string {
  if (!activeDS) return "";
  const snapshot = lookupApproval(activeDS.approvals, surface);
  if (!snapshot) return "diverged";
  if (surface.id === activePage?.id) {
    return divergence ? "diverged" : "approved";
  }
  const variant =
    surface.variants.find((v) => v.id === snapshot.variantId) ??
    surface.variants[0] ??
    null;
  const resolved = resolveSurfaceState(surface, activeDS, {
    liveVariantId: variant?.id ?? null,
  });
  const surfaceTweaks = collectSurfaceTweaks(activeDS, surface, variant);
  return computeDivergence(surfaceTweaks, resolved.variantId, resolved.tweaks, snapshot)
    ? "diverged"
    : "approved";
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
      touchedTweakIds.add(id);
      const ctx = activeContext();
      const ctxName = mode === "designs" ? activeDesign?.name : activeDS ? `ds:${activeDS.name}` : "";
      if (ctxName && activePage && activeVariant) {
        // Persist only the keys the user touched so stored state stays
        // small and reloads reconstruct an accurate touched set from
        // Object.keys(stored).
        saveStoredValues(
          ctxName,
          activePage.id,
          activeVariant.id,
          filterToTouched(tweakValues, touchedTweakIds),
        );
      }
      sendTweaks(tweaks);
      if (mode === "design-systems") {
        scheduleDivergenceRecompute();
        scheduleSyncRecompute();
      }
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
    onResetSurface: mode === "design-systems" ? () => resetSurfaceToBaseline() : undefined,
    resetLabel: `Reset entire ${activePage.label ?? activePage.id} surface`,
  });
  renderChosenPill();
  renderBackButton();
  recomputeDivergence();
  recomputeSyncDivergences();
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
  const tweaks = collectTweaks(activeDesign.index, activePage, activeVariant);
  const split = partitionByType(tweaks, tweakValues);
  if (!(await confirmFinalizeDiscards(activeDesign, [activePage], { [activePage.id]: activeVariant.id }))) return;
  const entry: ChosenPage = {
    variantId: activeVariant.id,
    tweaks: split.tweaks,
    ...(Object.keys(split.state).length > 0 ? { state: split.state } : {}),
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
  const variantPicks: Record<string, string> = {};
  for (const page of activeDesign.pages) {
    const variantId = loadActiveVariant(activeDesign.name, page.id) ?? page.variants[0]?.id;
    if (!variantId) continue;
    const variant = page.variants.find((v) => v.id === variantId) ?? page.variants[0];
    const tweaks = collectTweaks(activeDesign.index, page, variant);
    const stored = loadStoredValues(activeDesign.name, page.id, variantId);
    // Stored values are touched-only. Densify against the schema so that
    // the partitioner can route state values out of `tweaks` into `state`.
    const split = partitionByType(tweaks, stored);
    allPages[page.id] = {
      variantId,
      tweaks: split.tweaks,
      ...(Object.keys(split.state).length > 0 ? { state: split.state } : {}),
    };
    variantPicks[page.id] = variantId;
  }
  if (!(await confirmFinalizeDiscards(activeDesign, activeDesign.pages, variantPicks))) return;
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

// Show a modal listing every variant and select/toggle tweak that will drop
// from production at finalize time, with the recorded discardReason. The
// user must confirm to proceed. Returns true to continue, false to cancel.
async function confirmFinalizeDiscards(
  design: NormalizedDesign,
  pages: Page[],
  variantPicks: Record<string, string>,
): Promise<boolean> {
  type Discard = { scope: string; label: string; reason: string };
  const discards: Discard[] = [];
  for (const page of pages) {
    const pickedVariantId = variantPicks[page.id];
    for (let i = 0; i < page.variants.length; i++) {
      const v = page.variants[i];
      if (v.id === pickedVariantId) continue;
      if (i === 0) continue; // first variant has no discardReason convention
      discards.push({
        scope: page.label ?? page.id,
        label: `Variant ${v.label ?? v.id}`,
        reason: v.discardReason?.trim() || "(no reason recorded)",
      });
    }
    const tweaks = [
      ...(design.index.tweaks ?? []),
      ...(page.tweaks ?? []),
    ];
    for (const t of tweaks) {
      if (t.type !== "select" && t.type !== "toggle") continue;
      discards.push({
        scope: page.label ?? page.id,
        label: `${t.type === "select" ? "Select" : "Toggle"} tweak "${t.label}"`,
        reason: (t as { discardReason?: string }).discardReason?.trim() || "(no reason recorded)",
      });
    }
  }
  if (discards.length === 0) return true;
  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-od-finalize-confirm", "");
    overlay.className = "od-modal-overlay";
    const dialog = document.createElement("div");
    dialog.className = "od-modal-dialog";
    const heading = document.createElement("h2");
    heading.textContent = "Confirm finalize";
    dialog.appendChild(heading);
    const intro = document.createElement("p");
    intro.textContent =
      "These alternatives drop from production when this design is integrated. Their recorded reasons:";
    dialog.appendChild(intro);
    const list = document.createElement("ul");
    list.className = "od-discard-list";
    for (const d of discards) {
      const li = document.createElement("li");
      const head = document.createElement("strong");
      head.textContent = `${d.scope} – ${d.label}`;
      const reason = document.createElement("div");
      reason.className = "od-discard-reason";
      reason.textContent = d.reason;
      li.append(head, reason);
      list.appendChild(li);
    }
    dialog.appendChild(list);
    const actions = document.createElement("div");
    actions.className = "od-modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary";
    confirm.textContent = "Finalize";
    confirm.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    actions.append(cancel, confirm);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    confirm.focus();
  });
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
    headers: WRITE_HEADERS,
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

// Approval flow ------------------------------------------------------------

function currentSurface(): Surface | null {
  if (mode !== "design-systems" || !activeDS || !activePage) return null;
  return surfaceOf(activeDS, activePage.id) ?? null;
}

function currentSnapshot(): ReturnType<typeof lookupApproval> {
  const surface = currentSurface();
  if (!surface || !activeDS) return null;
  return lookupApproval(activeDS.approvals, surface);
}

function recomputeDivergence(): void {
  const surface = currentSurface();
  if (!surface) {
    setDivergence(false);
    return;
  }
  const snapshot = currentSnapshot();
  const variantId = activeVariant?.id ?? null;
  const tweaks = collectTweaks(activeDesign?.index, activePage!, activeVariant!);
  // Only compare the designer-decision keys; state values aren't part of
  // approvals. partitionByType strips the `state` half off the active map.
  const designerValues = partitionByType(tweaks, tweakValues).tweaks;
  setDivergence(computeDivergence(tweaks, variantId, designerValues, snapshot));
}

function scheduleDivergenceRecompute(): void {
  if (divergenceTimer) window.clearTimeout(divergenceTimer);
  divergenceTimer = window.setTimeout(() => {
    divergenceTimer = null;
    recomputeDivergence();
  }, DIVERGENCE_DEBOUNCE_MS);
}

// Shared debounce so the sync-panel recompute runs alongside the approval
// divergence recompute – same 100ms window, independent state.
let syncRecomputeTimer: number | null = null;
function scheduleSyncRecompute(): void {
  if (syncRecomputeTimer) window.clearTimeout(syncRecomputeTimer);
  syncRecomputeTimer = window.setTimeout(() => {
    syncRecomputeTimer = null;
    recomputeSyncDivergences();
  }, SYNC_RECOMPUTE_DEBOUNCE_MS);
}

function setDivergence(next: boolean): void {
  const changed = divergence !== next;
  divergence = next;
  document.body.classList.toggle("has-divergence", next);
  renderApprovalButtons();
  if (changed) refreshDotsIfChanged();
}

function renderApprovalButtons(): void {
  const surface = currentSurface();
  if (!surface) {
    approveBtn.textContent = "Approve surface";
    approveBtn.classList.remove("approved");
    approveBtn.title = "Approve the current surface as-is";
    return;
  }
  const approved = currentSnapshot() !== null && !divergence;
  approveBtn.textContent = approved ? "Approved ✓" : "Approve surface";
  approveBtn.classList.toggle("approved", approved);
  approveBtn.title = approved
    ? "Click to un-approve this surface"
    : "Approve the current surface as-is";
}

function refreshDotsIfChanged(): void {
  if (mode !== "design-systems" || !activeDS) {
    lastDotState.clear();
    return;
  }
  let changed = false;
  for (const s of activeDS.surfaces) {
    const key = approvalKey(s);
    const next = dotForSurface(s);
    if (lastDotState.get(key) !== next) {
      lastDotState.set(key, next);
      changed = true;
    }
  }
  if (changed) populatePageSelect();
}

// Sync panel --------------------------------------------------------------

function currentSurfaceKey(): string | null {
  const surface = currentSurface();
  if (!surface || !activeDS) return null;
  return `${activeDS.name}:${approvalKey(surface)}`;
}

function collectActiveTweaks(): Tweak[] {
  if (!activePage || !activeVariant) return [];
  return collectTweaks(activeDesign?.index, activePage, activeVariant);
}

function recomputeSyncDivergences(): void {
  if (mode !== "design-systems" || !activeDS || !activePage || !activeVariant) {
    syncDivergences = [];
    renderSyncPanel();
    return;
  }
  const tweaks = collectActiveTweaks();
  syncDivergences = computeTokenDivergences(tweaks, tweakValues, tokensMap, touchedTweakIds);
  renderSyncPanel();
}

function renderSyncPanel(): void {
  const surfaceKey = currentSurfaceKey();
  const shouldShow =
    mode === "design-systems" &&
    !!surfaceKey &&
    syncDivergences.length > 0 &&
    syncDismissedKey !== surfaceKey;

  // The tweaks-panel Reset row shares the sync-panel visibility signal.
  // Toggle it here so every tweak-change (debounced sync recompute) keeps
  // it in lockstep without re-rendering the tweaks body.
  const tweakReset = tweaksBody.querySelector(".tweak-reset") as HTMLElement | null;
  if (tweakReset) tweakReset.hidden = !canResetSurface();

  if (!shouldShow) {
    syncPanel.hidden = true;
    return;
  }
  const total = syncDivergences.length;
  const surfaceLabel = activePage?.label ?? activePage?.id ?? "surface";
  const tweakPhrase = total === 1 ? "1 tweak" : `${total} tweaks`;
  const tweakVerb = total === 1 ? "differs" : "differ";
  const dsName = activeDS?.name ?? "the design system";
  // The comparison is "this surface's emitted CSS values vs the DS's
  // tokens.css" – say so. The previous copy mentioned "N other surfaces"
  // which was misleading: nothing in this panel reads other surfaces.
  syncSubtitle.textContent = `${tweakPhrase} on ${surfaceLabel} ${tweakVerb} from \`${dsName}/tokens.css\`.`;

  syncList.innerHTML = "";
  for (const div of syncDivergences) {
    syncList.appendChild(renderSyncRow(div));
  }
  syncResetBtn.textContent = `Reset entire ${surfaceLabel} surface`;
  syncResetBtn.hidden = !canResetSurface();
  syncPanel.hidden = false;
}

function renderSyncRow(div: SyncDivergence): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "sync-row";

  const head = document.createElement("div");
  head.className = "sync-row-head";
  const label = document.createElement("span");
  label.className = "sync-row-label";
  label.textContent = div.tweakLabel;
  head.appendChild(label);
  const chip = document.createElement("span");
  chip.className = "sync-row-chip";
  chip.textContent = summariseTransform(div);
  head.appendChild(chip);
  li.appendChild(head);

  const targets = document.createElement("div");
  targets.className = "sync-row-targets";
  for (const row of div.rows) {
    const line = document.createElement("div");
    line.className = "sync-target";
    const name = document.createElement("span");
    name.className = "sync-target-name";
    name.textContent = row.target;
    line.appendChild(name);

    if (isColorValue(row.tokensValue) || isColorValue(row.currentValue)) {
      const prevSwatch = swatch(row.tokensValue);
      if (prevSwatch) line.appendChild(prevSwatch);
    }
    const before = document.createElement("span");
    before.textContent = row.tokensValue ?? "(undeclared)";
    line.appendChild(before);
    const arrow = document.createElement("span");
    arrow.className = "sync-target-arrow";
    arrow.textContent = "→";
    line.appendChild(arrow);
    if (isColorValue(row.currentValue)) {
      const nowSwatch = swatch(row.currentValue);
      if (nowSwatch) line.appendChild(nowSwatch);
    }
    const after = document.createElement("span");
    after.className = "sync-target-now";
    after.textContent = row.currentValue;
    line.appendChild(after);
    targets.appendChild(line);
  }
  li.appendChild(targets);
  return li;
}

function summariseTransform(div: SyncDivergence): string {
  const n = div.rows.length;
  const targetBit = n === 1 ? "1 target" : `${n} targets`;
  if (div.transform === "add") {
    const scalar = div.scalar ?? "0";
    const sign = parseFloat(scalar) >= 0 ? "+" : "";
    return `add ${sign}${scalar}${div.unit ?? ""} to ${targetBit}`;
  }
  if (div.transform === "scale") {
    return `scale ×${div.scalar ?? "1"} across ${targetBit}`;
  }
  return `set across ${targetBit}`;
}

function isColorValue(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  // Require the opening paren so a token whose name happens to start with
  // "rgb"/"hsl"/etc can't be misread as a color function.
  return /^#[0-9a-f]{3,8}$/.test(s) || /^(rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/.test(s);
}

function swatch(value: string | null): HTMLElement | null {
  if (!value) return null;
  const el = document.createElement("span");
  el.className = "sync-swatch";
  el.style.background = value;
  return el;
}

function dismissSyncPanel(): void {
  syncDismissedKey = currentSurfaceKey();
  syncPanel.hidden = true;
}

function copyPromotePrompt(): void {
  if (!activeDS || !activePage || syncDivergences.length === 0) return;
  const surface = currentSurface();
  if (!surface) return;
  const previewFile = surface.file || `${surface.id}.html`;
  const pageFile = activeVariant?.file || `${surface.id}.html`;
  const surfacePath =
    surface.kind === "tokens" ? `preview/${previewFile}` : `pages/${pageFile}`;
  const surfaceLabel =
    surface.kind === "tokens"
      ? `Tokens · ${surface.label}`
      : `Pages · ${surface.label}`;
  const ctx = { dsName: activeDS.name, surfaceLabel, surfacePath };
  const text = buildPromotePrompt(ctx, syncDivergences);
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast(`Copied prompt to update the design system – paste into Claude Code.`);
      dismissSyncPanel();
    })
    .catch(() => showToast("Clipboard blocked – select the text and copy manually."));
}

// Mirrors the sync-panel visibility condition: Reset surfaces whenever the
// surface is out of sync with tokens.css. Tied to the same signal so the
// tweaks-panel Reset and the sync-panel Reset toggle together.
function canResetSurface(): boolean {
  if (mode !== "design-systems" || !activeDS || !activePage || !activeVariant) return false;
  return syncDivergences.length > 0;
}

// Reset tweak values + variant back to the last-approved snapshot for this
// surface, or to the tweak schema defaults if no snapshot exists. Purely
// local – writes to storage, applies to the iframe, recomputes divergences.
function resetSurfaceToBaseline(): void {
  if (mode !== "design-systems" || !activeDS || !activePage || !activeVariant) return;
  const surface = currentSurface();
  if (!surface) return;
  const ctxName = `ds:${activeDS.name}`;
  const snapshot = currentSnapshot();
  let targetVariant: VariantEntry | null = activeVariant;
  if (snapshot && snapshot.variantId) {
    const match = activePage.variants.find((v) => v.id === snapshot.variantId);
    if (match) targetVariant = match;
  }
  // Variant may have changed – re-compute tweak chain against the target variant.
  const tweaks = collectTweaks(activeDesign?.index, activePage, targetVariant!);
  const nextValues = snapshot?.tweaks
    ? { ...snapshot.tweaks }
    : buildInitialValues(tweaks, {});

  // When resetting to schema defaults, persist an empty map so the surface
  // returns to a pristine "untouched" state. Saving the expanded fallback
  // values would mark every tweak as touched and resurface phantom
  // divergences on tweaks that declare no `default`.
  const storedValues = snapshot?.tweaks ? { ...snapshot.tweaks } : {};

  // Hand off: if the target variant differs from the active one, use the
  // normal selectVariant path so the iframe reloads too.
  if (targetVariant!.id !== activeVariant.id) {
    saveStoredValues(ctxName, activePage.id, targetVariant!.id, storedValues);
    selectVariant(targetVariant!);
    showToast(snapshot ? "Reset to approved snapshot." : "Reset to schema defaults.");
    return;
  }
  tweakValues = nextValues;
  touchedTweakIds = new Set(Object.keys(storedValues));
  saveStoredValues(ctxName, activePage.id, activeVariant.id, storedValues);
  sendTweaks(tweaks);
  renderPanel();
  showToast(snapshot ? "Reset to approved snapshot." : "Reset to schema defaults.");
}

async function approveCurrentSurface(): Promise<void> {
  if (mode !== "design-systems" || !activeDS || !activePage) return;
  const surface = currentSurface();
  if (!surface) return;
  const isApproved = currentSnapshot() !== null && !divergence;
  const tweaks = collectTweaks(activeDesign?.index, activePage!, activeVariant!);
  // Filter to (a) keys the user touched – untouched tweaks expand to fallback
  // defaults that would pollute approvals.json and break divergence checks if
  // defaults ever change – and (b) non-state tweaks. State values are runtime
  // conditions and don't belong in approvals.
  const touchedDesignerTweaks = partitionByType(
    tweaks,
    filterToTouched(tweakValues, touchedTweakIds),
  ).tweaks;
  const body = isApproved
    ? {
        action: "clear",
        surfaceKind: surface.kind,
        surfaceId: surface.id,
      }
    : {
        action: "set",
        surfaceKind: surface.kind,
        surfaceId: surface.id,
        variantId: activeVariant?.id ?? null,
        tweaks: touchedDesignerTweaks,
      };
  try {
    const r = await fetch(`${DATA_ROOT}/design-systems/${activeDS.name}/approvals`, {
      method: "POST",
      headers: WRITE_HEADERS,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const res = (await r.json()) as { ok: boolean; approvals: Approvals };
    if (!res || typeof res !== "object" || !res.approvals || typeof res.approvals.surfaces !== "object") {
      throw new Error("approvals response missing surfaces map");
    }
    activeDS.approvals = res.approvals;
    recomputeDivergence();
    populatePageSelect();
    showToast(isApproved ? `Un-approved ${surface.label}.` : `Approved ${surface.label}.`);
  } catch (err) {
    console.error(err);
    showToast(`${isApproved ? "Un-approve" : "Approve"} failed: ${(err as Error).message}`);
  }
}

function resetToSnapshot(): void {
  const surface = currentSurface();
  const snapshot = currentSnapshot();
  if (!surface || !snapshot || !activeDS || !activePage || !activeVariant) return;
  const ctxName = `ds:${activeDS.name}`;
  const snapshotTweaks = snapshot.tweaks ?? {};
  const tweaks = collectTweaks(activeDesign?.index, activePage, activeVariant);
  // Snapshots only store touched tweaks, so rebuild a full value map by
  // filling defaults for tweaks the snapshot omits.
  tweakValues = buildInitialValues(tweaks, snapshotTweaks);
  touchedTweakIds = new Set(Object.keys(snapshotTweaks));
  saveStoredValues(ctxName, activePage.id, activeVariant.id, snapshotTweaks);
  sendTweaks(tweaks);
  renderPanel();
  recomputeDivergence();
  recomputeSyncDivergences();
}

// Return only the keys the user has actually touched – used when sending
// snapshots to approvals.json so we don't persist fallback defaults.
function filterToTouched(
  values: Record<string, string>,
  touched: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of touched) {
    if (id in values) out[id] = values[id];
  }
  return out;
}

async function promoteTweak(tweak: Tweak): Promise<void> {
  if (!activeDS) return;
  const value = tweakValues[tweak.id];
  if (value === undefined) return;
  // Single-target + set is the fast path. Multi-target / transform tweaks
  // are ambiguous for a single POST – the sync panel's Copy promote prompt
  // handles those.
  if (!tweak.target || (tweak.transform && tweak.transform !== "set")) {
    showToast("Use the sync panel's Copy promote prompt for multi-target or transform tweaks.");
    return;
  }
  try {
    const r = await fetch(`${DATA_ROOT}/design-systems/${activeDS.name}/promote`, {
      method: "POST",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ target: tweak.target, value }),
    });
    if (!r.ok) throw new Error(await r.text());
    showToast(`Promoted ${tweak.target} → tokens.css.`);
    await refreshTokensMap();
    recomputeSyncDivergences();
  } catch (err) {
    console.error(err);
    showToast(`Promote failed: ${(err as Error).message}`);
  }
}

function togglePicker(force?: boolean): void {
  const next = force ?? !picker.isEnabled();
  picker.setEnabled(next);
  pickerToggle.setAttribute("aria-checked", String(next));
  bridge.setPicker(next);
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
      clearSelections();
      composerInput.value = "";
    })
    .catch(() => showToast("Clipboard blocked – select the text and copy manually."));
}

function showEmpty(): void {
  iframe.hidden = true;
  // Clear any pending fade so a later content-bearing refresh isn't stuck invisible.
  iframe.classList.remove("fading");
  if (mode === "designs") {
    emptyState.hidden = false;
    emptyStateDs.hidden = true;
  } else {
    emptyState.hidden = true;
    emptyStateDs.hidden = false;
  }
  activeDesign = null;
  activeDS = null;
  activePage = null;
  activeVariant = null;
  clearPageHistory();
  togglePicker(false);
  document.body.classList.add("no-drafts");
}

// Panel drag (shared by tweaks + sync) --------------------------------------

function loadCorner(storageKey: string, fallback: Corner): Corner {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw && (CORNERS as string[]).includes(raw)) return raw as Corner;
  } catch {
    /* ignore */
  }
  return fallback;
}

function saveCorner(storageKey: string, c: Corner): void {
  try {
    localStorage.setItem(storageKey, c);
  } catch {
    /* ignore */
  }
}

function applyCorner(panel: HTMLElement, corner: Corner): void {
  for (const c of CORNERS) panel.classList.remove(`corner-${c}`);
  panel.classList.add(`corner-${corner}`);
}

function wirePanelDrag(panel: HTMLElement, storageKey: string): void {
  const header = panel.querySelector("header") as HTMLElement | null;
  if (!header) return;

  let startX = 0;
  let startY = 0;
  let dragging = false;

  header.addEventListener("pointerdown", (e) => {
    // Don't hijack clicks on the close button (×) or any control.
    const tgt = e.target as HTMLElement;
    if (tgt.closest("button")) return;
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    header.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);

    const prevRect = panel.getBoundingClientRect();
    const centerX = prevRect.left + prevRect.width / 2;
    const centerY = prevRect.top + prevRect.height / 2;
    const isLeft = centerX < window.innerWidth / 2;
    const isTop = centerY < window.innerHeight / 2;
    const next: Corner = `${isTop ? "t" : "b"}${isLeft ? "l" : "r"}` as Corner;

    panel.style.transform = "";
    applyCorner(panel, next);
    const newRect = panel.getBoundingClientRect();
    const deltaX = prevRect.left - newRect.left;
    const deltaY = prevRect.top - newRect.top;

    panel.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    void panel.offsetWidth;

    panel.classList.remove("dragging");
    panel.style.transform = "";
    saveCorner(storageKey, next);
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
  toastTimer = window.setTimeout(() => toast?.classList.remove("visible"), TOAST_VISIBLE_MS);
}
