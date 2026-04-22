import type { Tweak } from "./types";

const STORAGE_PREFIX = "od:tweaks:";
const PANEL_STATE_KEY = "od:panel-open";

export interface TweakBinding {
  tweaks: Tweak[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}

// URL-encode each segment so IDs containing `:` can't alias across keys
// (e.g. project "a:b" + page "c" must not collide with project "a" + page
// "b:c"). Encoding is identity for ASCII-safe IDs, so existing values stay
// readable on disk.
function storageKey(project: string, page: string, variant: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(project)}:${encodeURIComponent(page)}:${encodeURIComponent(variant)}`;
}

export function loadStoredValues(
  project: string,
  page: string,
  variant: string,
): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(project, page, variant));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStoredValues(
  project: string,
  page: string,
  variant: string,
  values: Record<string, string>,
): void {
  try {
    localStorage.setItem(storageKey(project, page, variant), JSON.stringify(values));
  } catch {
    /* ignore quota or serialization errors */
  }
}

export function isPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_STATE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function savePanelOpen(open: boolean): void {
  try {
    localStorage.setItem(PANEL_STATE_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function resolveSelectValue(tweak: Tweak, raw: string): string {
  if (!tweak.options) return raw;
  for (const opt of tweak.options) {
    if (typeof opt === "string") {
      if (opt === raw) return opt;
    } else if (opt.value === raw || opt.label === raw) {
      return opt.value;
    }
  }
  return raw;
}

function defaultFor(tweak: Tweak): string {
  if (tweak.default !== undefined) return String(tweak.default);
  switch (tweak.type) {
    case "toggle":
      return tweak.off ?? "0";
    case "slider":
      return String(tweak.min ?? 0);
    case "color":
      return "#000000";
    case "select":
    case "state": {
      const first = tweak.options?.[0];
      if (first === undefined) return "";
      return typeof first === "string" ? first : first.value;
    }
    default:
      return "";
  }
}

export function buildInitialValues(
  tweaks: Tweak[],
  stored: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tweaks) {
    out[t.id] = stored[t.id] ?? defaultFor(t);
  }
  return out;
}

export function cssValueFor(tweak: Tweak, raw: string): string {
  switch (tweak.type) {
    case "slider": {
      const unit = tweak.unit ?? "";
      return `${raw}${unit}`;
    }
    case "select":
    case "state":
      return resolveSelectValue(tweak, raw);
    case "toggle":
      return raw === "1" ? (tweak.on ?? "1") : (tweak.off ?? "0");
    default:
      return raw;
  }
}

export function applyTweaksToIframe(
  iframe: HTMLIFrameElement,
  tweaks: Tweak[],
  values: Record<string, string>,
): void {
  const doc = iframe.contentDocument;
  if (!doc) return;
  const cssParts: string[] = [];
  for (const t of tweaks) {
    const resolved = cssValueFor(t, values[t.id] ?? defaultFor(t));
    if (t.type === "state") {
      doc.documentElement.setAttribute("data-state", resolved);
    } else {
      cssParts.push(`${t.target}: ${resolved};`);
    }
  }
  let style = doc.getElementById("od-tweaks-vars") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "od-tweaks-vars";
    doc.head.appendChild(style);
  }
  style.textContent = `:root { ${cssParts.join(" ")} }`;
}

export function renderTweaksPanel(args: {
  root: HTMLElement;
  variants: Array<{ id: string; label: string }>;
  activeVariant: string;
  onVariant: (id: string) => void;
  tweaks: Tweak[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  chosenVariantId?: string;
  pageLabel?: string;
  showFinalizeAll?: boolean;
  onFinalize?: () => void;
  onFinalizeAll?: () => void;
  onClearChosen?: () => void;
  showPromote?: boolean;
  onPromote?: (tweak: Tweak) => void;
}): void {
  const {
    root,
    variants,
    activeVariant,
    onVariant,
    tweaks,
    values,
    onChange,
    chosenVariantId,
    pageLabel,
    showFinalizeAll,
    onFinalize,
    onFinalizeAll,
    onClearChosen,
    showPromote,
    onPromote,
  } = args;
  root.innerHTML = "";

  if (variants.length > 1) {
    const group = document.createElement("div");
    group.className = "tweak variant";
    const label = document.createElement("label");
    label.textContent = "Variant";
    const select = document.createElement("select");
    for (const v of variants) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.id === chosenVariantId ? `${v.label} ★` : v.label;
      if (v.id === activeVariant) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => onVariant(select.value));
    group.append(label, select);
    root.appendChild(group);
  }

  if (!tweaks.length) {
    const empty = document.createElement("p");
    empty.className = "tweak-empty";
    empty.textContent = "No tweaks declared for this draft.";
    root.appendChild(empty);
  } else {
    for (const tweak of tweaks) {
      root.appendChild(
        renderTweak(tweak, values[tweak.id] ?? defaultFor(tweak), onChange, {
          showPromote,
          onPromote,
        }),
      );
    }
  }

  if (onFinalize) {
    const actions = document.createElement("div");
    actions.className = "tweak-finalize";
    const isChosen = chosenVariantId === activeVariant;

    const finalizeBtn = document.createElement("button");
    finalizeBtn.type = "button";
    finalizeBtn.className = "primary";
    const pageSuffix = pageLabel ? ` (${pageLabel})` : "";
    finalizeBtn.textContent = isChosen
      ? `Re-finalize this page${pageSuffix}`
      : `Finalize this page${pageSuffix}`;
    finalizeBtn.addEventListener("click", () => onFinalize());
    actions.appendChild(finalizeBtn);

    if (showFinalizeAll && onFinalizeAll) {
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "tweak-finalize-all";
      allBtn.textContent = "Finalize all pages";
      allBtn.addEventListener("click", () => onFinalizeAll());
      actions.appendChild(allBtn);
    }

    if (chosenVariantId && onClearChosen) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "tweak-clear-chosen";
      clearBtn.textContent = "Clear chosen";
      clearBtn.addEventListener("click", () => onClearChosen());
      actions.appendChild(clearBtn);
    }

    root.appendChild(actions);
  }
}

function renderTweak(
  tweak: Tweak,
  value: string,
  onChange: (id: string, value: string) => void,
  opts: {
    showPromote?: boolean;
    onPromote?: (tweak: Tweak) => void;
  } = {},
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `tweak tweak-${tweak.type}`;

  const labelRow = document.createElement("div");
  labelRow.className = "tweak-label-row";
  const label = document.createElement("label");
  label.textContent = tweak.label;
  label.htmlFor = `tweak-${tweak.id}`;
  labelRow.appendChild(label);
  if (opts.showPromote && opts.onPromote) {
    const promote = document.createElement("button");
    promote.type = "button";
    promote.className = "tweak-promote";
    promote.textContent = "Promote";
    promote.title = `Write this value into tokens.css at ${tweak.target}`;
    promote.addEventListener("click", () => opts.onPromote?.(tweak));
    labelRow.appendChild(promote);
  }
  wrap.appendChild(labelRow);

  let control: HTMLElement;
  switch (tweak.type) {
    case "select":
    case "state": {
      const select = document.createElement("select");
      select.id = `tweak-${tweak.id}`;
      for (const opt of tweak.options ?? []) {
        const option = document.createElement("option");
        if (typeof opt === "string") {
          option.value = opt;
          option.textContent = opt;
        } else {
          option.value = opt.value;
          option.textContent = opt.label;
        }
        if (option.value === value) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener("change", () => onChange(tweak.id, select.value));
      control = select;
      break;
    }
    case "color": {
      const row = document.createElement("div");
      row.className = "color-row";
      const input = document.createElement("input");
      input.type = "color";
      input.id = `tweak-${tweak.id}`;
      // Walk the fallback chain: current value -> declared default -> #000000.
      // Keeps the declared default respected even when a stale non-hex value
      // slipped through (e.g. a `currentColor` leftover from an earlier edit).
      const hexRe = /^#[0-9a-fA-F]{6}$/;
      const declaredDefault = String(tweak.default ?? "");
      input.value = hexRe.test(value)
        ? value
        : hexRe.test(declaredDefault)
          ? declaredDefault
          : "#000000";
      const hex = document.createElement("span");
      hex.className = "color-hex";
      hex.textContent = input.value;
      input.addEventListener("input", () => {
        hex.textContent = input.value;
        onChange(tweak.id, input.value);
      });
      row.append(input, hex);
      control = row;
      break;
    }
    case "slider": {
      const row = document.createElement("div");
      row.className = "slider-row";
      const input = document.createElement("input");
      input.type = "range";
      input.id = `tweak-${tweak.id}`;
      input.min = String(tweak.min ?? 0);
      input.max = String(tweak.max ?? 100);
      input.step = String(tweak.step ?? 1);
      input.value = value;
      const read = document.createElement("span");
      read.className = "slider-readout";
      read.textContent = `${value}${tweak.unit ?? ""}`;
      input.addEventListener("input", () => {
        read.textContent = `${input.value}${tweak.unit ?? ""}`;
        onChange(tweak.id, input.value);
      });
      row.append(input, read);
      control = row;
      break;
    }
    case "toggle": {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = `tweak-${tweak.id}`;
      input.checked = value === "1" || value === (tweak.on ?? "1");
      input.addEventListener("change", () => onChange(tweak.id, input.checked ? "1" : "0"));
      control = input;
      break;
    }
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.id = `tweak-${tweak.id}`;
      input.value = value;
      input.addEventListener("input", () => onChange(tweak.id, input.value));
      control = input;
    }
  }
  wrap.appendChild(control);
  return wrap;
}
