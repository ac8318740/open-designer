import type { TokensMap, Tweak, TweakTransform } from "./types";

const STORAGE_PREFIX = "od:tweaks:";
const PANEL_STATE_KEY = "od:panel-open";
// ID of the injected <style> element that carries tweak CSS variable
// overrides. Kept here so renames stay in one file.
const TWEAKS_STYLE_ID = "od-tweaks-vars";

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

type WithOptions = { options?: Array<string | { label: string; value: string }> };

function resolveSelectValue(tweak: WithOptions, raw: string): string {
  const options = tweak.options;
  if (!options) return raw;
  for (const opt of options) {
    if (typeof opt === "string") {
      if (opt === raw) return opt;
    } else if (opt.value === raw || opt.label === raw) {
      return opt.value;
    }
  }
  return raw;
}

export function defaultFor(tweak: Tweak): string {
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

// Returns the list of CSS variables this tweak writes to. `target` + `targets`
// are mutually exclusive; a tweak with neither is a declaration bug but we
// tolerate it (empty list means no variables are emitted).
export function resolvedTargets(tweak: Tweak): string[] {
  if (Array.isArray(tweak.targets) && tweak.targets.length > 0) return tweak.targets;
  if (tweak.target) return [tweak.target];
  return [];
}

export function resolvedTransform(tweak: Tweak): TweakTransform {
  const t = tweak.transform;
  if (t === "add" || t === "scale") {
    if (tweak.type !== "slider") {
      // Non-slider types can't sensibly use add/scale. Warn once and treat as set.
      console.warn(
        `[od] tweak "${tweak.id}" uses transform "${t}" but type "${tweak.type}" is not slider – treating as "set".`,
      );
      return "set";
    }
    return t;
  }
  return "set";
}

// Extract the first number from a CSS value like "4px", "1.5rem", "0".
// Returns null if no number is present (e.g. for color values).
export function parseNumericToken(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Compute the CSS emission for a single (tweak, target) pair. Returns null
// if the transform can't resolve (e.g. add/scale against a token missing
// from tokensMap) – the caller should skip emitting that pair.
export function emittedValueFor(
  tweak: Tweak,
  raw: string,
  target: string,
  tokensMap: TokensMap | null,
): string | null {
  const transform = resolvedTransform(tweak);
  if (transform === "set") return cssValueFor(tweak, raw);
  const base = parseNumericToken(tokensMap?.get(target));
  if (base === null) return null;
  const delta = parseFloat(raw);
  if (!Number.isFinite(delta)) return null;
  // resolvedTransform only returns "add"/"scale" for slider tweaks – at this
  // point in the function `transform` is non-"set", so the cast is sound.
  const unit = (tweak as { unit?: string }).unit ?? "";
  const next = transform === "add" ? base + delta : base * delta;
  // Trim trailing zeros so 6.00 reads as 6 (keeps promote-prompt output tidy).
  return `${+next.toFixed(4)}${unit}`;
}

export function applyTweaksToIframe(
  iframe: HTMLIFrameElement,
  tweaks: Tweak[],
  values: Record<string, string>,
  tokensMap: TokensMap | null = null,
): void {
  const doc = iframe.contentDocument;
  if (!doc) return;
  const cssParts: string[] = [];
  // If multiple state tweaks exist (rare), the last one wins – the docs only
  // commit to one at a time.
  let stateAttr: string | null = null;
  for (const t of tweaks) {
    const raw = values[t.id] ?? defaultFor(t);
    // Discrete-valued tweaks also expose their value as data-{id} on <html>
    // so designs can switch CSS bundles per option via attribute selectors
    // (`:root[data-card-density="cozy"] { ... }`) without a JS shim. Slider
    // / color / text are continuous and stay variable-only.
    if (t.type === "select" || t.type === "toggle" || t.type === "state") {
      doc.documentElement.setAttribute(`data-${t.id}`, cssValueFor(t, raw));
    }
    if (t.type === "state") {
      stateAttr = cssValueFor(t, raw);
      continue;
    }
    for (const target of resolvedTargets(t)) {
      const emitted = emittedValueFor(t, raw, target, tokensMap);
      if (emitted === null) continue;
      cssParts.push(`${target}: ${emitted};`);
    }
  }
  if (stateAttr !== null) doc.documentElement.setAttribute("data-state", stateAttr);
  let style = doc.getElementById(TWEAKS_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = TWEAKS_STYLE_ID;
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
  // DS-mode only: render a "Reset surface" row at the bottom of the body.
  onResetSurface?: () => void;
  resetLabel?: string;
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
    onResetSurface,
    resetLabel,
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
      opt.textContent = v.id === chosenVariantId ? `★ ${v.label}` : v.label;
      if (v.id === activeVariant) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => onVariant(select.value));
    group.append(label, select);
    root.appendChild(group);
  }

  // Render real tweaks in the main body and state tweaks in a separate
  // "Inspect" section underneath. State tweaks aren't designer decisions –
  // they're runtime conditions exposed as a viewing aid – so the visual
  // separation matters for the finalize-discard test the user runs in
  // their head. Both lists may be empty; only render headers when populated.
  const realTweaks = tweaks.filter((t) => t.type !== "state");
  const stateTweaks = tweaks.filter((t) => t.type === "state");

  if (realTweaks.length === 0 && stateTweaks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tweak-empty";
    empty.textContent = "No tweaks declared.";
    root.appendChild(empty);
  } else {
    for (const tweak of realTweaks) {
      root.appendChild(
        renderTweak(tweak, values[tweak.id] ?? defaultFor(tweak), onChange, {
          showPromote,
          onPromote,
        }),
      );
    }
    if (stateTweaks.length > 0) {
      const section = document.createElement("div");
      section.className = "tweak-inspect-section";
      const header = document.createElement("h3");
      header.className = "tweak-section-header";
      header.textContent = "Inspect (runtime states)";
      section.appendChild(header);
      const help = document.createElement("p");
      help.className = "tweak-section-help";
      help.textContent =
        "Filter to one state at a time – the variant boots in the first state and you switch by picking another. Not a designer decision; production wires this to its state machine.";
      section.appendChild(help);
      for (const tweak of stateTweaks) {
        section.appendChild(
          renderTweak(tweak, values[tweak.id] ?? defaultFor(tweak), onChange, {
            showPromote: false,
            onPromote: undefined,
          }),
        );
      }
      root.appendChild(section);
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

  if (onResetSurface) {
    // Always rendered when the caller wires a reset handler, even if the
    // current state is in-sync. Visibility is toggled from elsewhere (sync
    // recompute) via the `hidden` attribute, so tweak drags don't have to
    // re-render the whole panel to keep this in lockstep with divergence.
    const resetWrap = document.createElement("div");
    resetWrap.className = "tweak-reset";
    resetWrap.hidden = true;
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "tweak-reset-btn";
    resetBtn.textContent = resetLabel ?? "Reset surface";
    resetBtn.addEventListener("click", () => onResetSurface());
    resetWrap.appendChild(resetBtn);
    root.appendChild(resetWrap);
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
  // Only single-target / set tweaks have an unambiguous per-tweak promote
  // target. Multi-target and add/scale tweaks route through the sync panel's
  // Copy promote prompt instead.
  const canPromoteInline =
    !!opts.showPromote &&
    !!opts.onPromote &&
    !!tweak.target &&
    (!tweak.transform || tweak.transform === "set");
  if (canPromoteInline) {
    const promote = document.createElement("button");
    promote.type = "button";
    promote.className = "tweak-promote";
    promote.innerHTML = `<span aria-hidden="true">→</span> tokens.css`;
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
