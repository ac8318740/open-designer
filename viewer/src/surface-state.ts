// One resolver, every consumer.
//
// Before this module, "what does surface X look like right now?" was answered
// three different ways – the active panel inlined its own logic, dotForSurface
// reached into localStorage, and approvals divergence rebuilt yet a third
// view. The three drifted: dotForSurface called untouched surfaces "diverged"
// while the panel called them "approved" against the snapshot. This module is
// the single answer.
//
// Output is "dense" – every tweak the surface declares appears in `tweaks`
// (or `state`, if it's a state tweak), filled in from defaults when neither
// localStorage nor the snapshot provides a value. Callers compare dense
// against dense, so a never-touched key on one side and a default-equal key
// on the other read as equal.

import { defaultFor, loadStoredValues } from "./tweaks";
import type {
  DesignSystemEntry,
  Page,
  Surface,
  Tweak,
  VariantEntry,
} from "./types";

export interface ResolvedSurfaceState {
  variantId: string | null;
  tweaks: Record<string, string>;
  state: Record<string, string>;
}

export interface ResolveOpts {
  // For the active surface – a live overlay of in-progress edits and the
  // selected variant. `liveValues` covers both `tweaks` and `state` since the
  // viewer's tweakValues map is unified.
  liveVariantId?: string | null;
  liveValues?: Record<string, string>;
  // Storage key for non-active surfaces. When omitted, falls back to a
  // localStorage read keyed off `ds:<dsName>` – which is the convention every
  // current caller uses.
  storageNamespace?: string;
}

// A NormalizedDS-like interface kept narrow so this module doesn't pull main.ts
// into the test bundle. The viewer's NormalizedDS satisfies this; tests can
// pass a hand-rolled object.
export interface SurfaceContext {
  name: string;
  surfaces: Surface[];
  pages: Page[];
}

export function resolveSurfaceState(
  surface: Surface,
  ds: SurfaceContext,
  opts: ResolveOpts = {},
): ResolvedSurfaceState {
  const ns = opts.storageNamespace ?? `ds:${ds.name}`;

  // Variant pick: live override (only when the caller passed it explicitly),
  // then storage, then the schema's first variant. Approvals are handled by
  // the caller because divergence cares about both sides.
  let variantId: string | null = null;
  if (opts.liveVariantId !== undefined) {
    variantId = opts.liveVariantId ?? null;
  } else {
    try {
      variantId = localStorage.getItem(activeVariantKey(ns, surface.id));
    } catch {
      variantId = null;
    }
  }
  if (variantId === null) {
    variantId = surface.variants[0]?.id ?? null;
  }

  const variant = surface.variants.find((v) => v.id === variantId) ?? null;
  const tweaks = collectSurfaceTweaks(ds, surface, variant);

  // Live values when this is the active surface; otherwise the persisted
  // touched-only map from localStorage. Either way, only `touched` keys are
  // present – we densify them below.
  let touched: Record<string, string>;
  if (opts.liveValues) {
    touched = opts.liveValues;
  } else if (variant) {
    touched = loadStoredValues(ns, surface.id, variant.id);
  } else {
    touched = {};
  }

  const tweakValues: Record<string, string> = {};
  const stateValues: Record<string, string> = {};
  for (const t of tweaks) {
    const value = touched[t.id] ?? defaultFor(t);
    if (t.type === "state") {
      stateValues[t.id] = value;
    } else {
      tweakValues[t.id] = value;
    }
  }

  return { variantId, tweaks: tweakValues, state: stateValues };
}

// Cleanly partition a unified tweak-values map by tweak type so callers can
// emit `chosen.pages[*].tweaks` and `chosen.pages[*].state` separately, or
// the equivalent for approvals.
export function partitionByType(
  tweaks: Tweak[],
  values: Record<string, string>,
): { tweaks: Record<string, string>; state: Record<string, string> } {
  const out = { tweaks: {} as Record<string, string>, state: {} as Record<string, string> };
  for (const t of tweaks) {
    if (!(t.id in values)) continue;
    if (t.type === "state") out.state[t.id] = values[t.id];
    else out.tweaks[t.id] = values[t.id];
  }
  return out;
}

// Compare current state against a snapshot. State values are intentionally
// excluded because they're runtime conditions, not designer decisions, and
// approvals only cover designer decisions.
//
// Both sides are densified through the schema's defaults before comparison.
// This is the load-bearing line: snapshots store only touched keys (so the
// approvals.json doesn't mention every fallback), and current state in the
// resolver is dense. Comparing sparse-vs-dense would phantom-diverge on
// any tweak that has no declared default. Densifying both with the same
// schema closes that gap.
export function isDivergent(
  surfaceTweaks: Tweak[],
  current: { variantId: string | null; tweaks: Record<string, string> },
  snapshot: { variantId: string | null; tweaks: Record<string, string> | null } | null,
): boolean {
  if (!snapshot) return true;
  if ((snapshot.variantId ?? null) !== (current.variantId ?? null)) return true;
  const snap = snapshot.tweaks ?? {};
  for (const t of surfaceTweaks) {
    if (t.type === "state") continue;
    const fallback = defaultFor(t);
    const currVal = current.tweaks[t.id] ?? fallback;
    const snapVal = snap[t.id] ?? fallback;
    if (currVal !== snapVal) return true;
  }
  return false;
}

export function collectSurfaceTweaks(
  ds: SurfaceContext,
  surface: Surface,
  variant: VariantEntry | null,
): Tweak[] {
  // DS mode has no design-level tweaks, so the chain is page + variant only.
  void ds;
  return [
    ...(surface.tweaks ?? []),
    ...(variant?.tweaks ?? []),
  ];
}

function activeVariantKey(ctxKey: string, pageId: string): string {
  return `od:active-variant:${encodeURIComponent(ctxKey)}:${encodeURIComponent(pageId)}`;
}

// Expose for tests.
export const _internals = { activeVariantKey };
