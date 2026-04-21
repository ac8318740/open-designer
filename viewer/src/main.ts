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
import type { DraftEntry, DraftIndex, ProjectEntry, Tweak } from "./types";

const DATA_ROOT = "/data";

// State ---------------------------------------------------------------------

const picker = new Picker();
let projects: ProjectEntry[] = [];
let activeProject: ProjectEntry | null = null;
let activeDraft: DraftEntry | null = null;
let tweakValues: Record<string, string> = {};

// DOM refs ------------------------------------------------------------------

const iframe = document.getElementById("draft-frame") as HTMLIFrameElement;
const stage = document.getElementById("stage")!;
const emptyState = document.getElementById("empty-state")!;
const projectLabel = document.getElementById("project-label")!;
const pickerToggle = document.getElementById("picker-toggle") as HTMLButtonElement;
const tweaksToggle = document.getElementById("tweaks-toggle") as HTMLButtonElement;
const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
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
  // Auto-focus the composer after a click inside the iframe so the user can
  // start typing without reaching for the mouse. preventScroll stops the
  // textarea from scrolling into view when it's already visible.
  if (selections.length > 0) composerInput.focus({ preventScroll: true });
});
picker.onLimitExceeded(() =>
  showToast(`Limit reached – max ${MAX_SELECTIONS} selections. Remove one to add another.`),
);

pickerToggle.addEventListener("click", () => togglePicker());
tweaksToggle.addEventListener("click", () => toggleTweaksPanel());
tweaksClose.addEventListener("click", () => toggleTweaksPanel(false));
refreshBtn.addEventListener("click", () => refresh());

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    togglePicker();
  }
});

const panelStartsOpen = isPanelOpen();
tweaksPanel.hidden = !panelStartsOpen;
tweaksToggle.setAttribute("aria-checked", String(panelStartsOpen));
pickerToggle.setAttribute("aria-checked", "false");

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
    if (!activeProject || !activeDraft) return;
    const activeUrl = `/drafts/${activeProject.project}/${activeDraft.file}`;
    if (path === activeUrl) {
      selectDraft(activeDraft);
    }
  });
}

// Actions -------------------------------------------------------------------

async function refresh(): Promise<void> {
  const prevProjectName = activeProject?.project;
  const prevDraftId = activeDraft?.id;

  projects = await loadProjects();
  if (projects.length === 0) {
    showEmpty();
    return;
  }
  emptyState.hidden = true;
  iframe.hidden = false;

  const proj = projects.find((p) => p.project === prevProjectName) ?? projects[0];
  activeProject = proj;
  const draft = proj.index.drafts.find((d) => d.id === prevDraftId) ?? proj.index.drafts[0];
  if (!draft) {
    showEmpty();
    return;
  }
  selectDraft(draft);
}

function selectDraft(draft: DraftEntry): void {
  if (!activeProject) return;
  activeDraft = draft;
  document.body.classList.remove("no-drafts");

  const tweaks = collectTweaks(activeProject.index, draft);
  const stored = loadStoredValues(activeProject.project, draft.id);
  tweakValues = buildInitialValues(tweaks, stored);

  projectLabel.textContent = `${activeProject.project} · ${draft.label ?? draft.id}`;
  iframe.src = `${DATA_ROOT}/drafts/${activeProject.project}/${draft.file}`;
  picker.clearAll();

  iframe.onload = () => {
    normalizeIframeLayout(iframe);
    picker.attach(iframe);
    if (picker.isEnabled()) {
      iframe.contentDocument?.body.classList.add("od-picker-on");
    }
    applyTweaksToIframe(iframe, tweaks, tweakValues);
    renderPanel();
  };
}

function collectTweaks(index: DraftIndex, draft: DraftEntry): Tweak[] {
  return [...(index.tweaks ?? []), ...(draft.tweaks ?? [])];
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
}

function renderPanel(): void {
  if (!activeProject || !activeDraft) return;
  const tweaks = collectTweaks(activeProject.index, activeDraft);
  const variants = activeProject.index.drafts.map((d) => ({ id: d.id, label: d.label ?? d.id }));
  renderTweaksPanel({
    root: tweaksBody,
    variants,
    activeVariant: activeDraft.id,
    onVariant: (id) => {
      const next = activeProject!.index.drafts.find((d) => d.id === id);
      if (next) selectDraft(next);
    },
    tweaks,
    values: tweakValues,
    onChange: (id, value) => {
      tweakValues[id] = value;
      saveStoredValues(activeProject!.project, activeDraft!.id, tweakValues);
      applyTweaksToIframe(iframe, tweaks, tweakValues);
    },
  });
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
  if (selections.length === 0 || !activeDraft || !activeProject) return;
  const payload = buildPayload({
    project: activeProject.project,
    file: activeDraft.file,
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
  activeDraft = null;
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
