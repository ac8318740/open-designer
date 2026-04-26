import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveSurfaceState, partitionByType, isDivergent } from "../surface-state";
import type { Surface, Tweak } from "../types";

// Stub localStorage for the resolver's variant fallback path.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
});

const baseTweaks: Tweak[] = [
  { id: "p", type: "slider", label: "P", default: 8, target: "--p" },
  { id: "loading", type: "state", label: "Loading", options: ["on", "off"] },
];

const surface: Surface = {
  kind: "page",
  id: "log",
  label: "Log",
  variants: [
    { id: "01-default", file: "01-default.html", label: "Default" },
    { id: "02-compact", file: "02-compact.html", label: "Compact" },
  ],
  tweaks: baseTweaks,
};

const ds = { name: "ds-a", surfaces: [surface], pages: [] };

describe("resolveSurfaceState", () => {
  it("falls back to schema's first variant when no live or stored value", () => {
    const r = resolveSurfaceState(surface, ds);
    expect(r.variantId).toBe("01-default");
  });

  it("respects an explicit live variant id", () => {
    const r = resolveSurfaceState(surface, ds, { liveVariantId: "02-compact" });
    expect(r.variantId).toBe("02-compact");
  });

  it("partitions tweaks vs state values into separate maps", () => {
    const r = resolveSurfaceState(surface, ds, {
      liveVariantId: "01-default",
      liveValues: { p: "16", loading: "on" },
    });
    expect(r.tweaks).toEqual({ p: "16" });
    expect(r.state).toEqual({ loading: "on" });
  });

  it("densifies tweaks with defaults for unset keys", () => {
    const r = resolveSurfaceState(surface, ds, {
      liveVariantId: "01-default",
      liveValues: {},
    });
    expect(r.tweaks).toEqual({ p: "8" });
  });
});

describe("partitionByType", () => {
  it("routes state values out of tweaks into state", () => {
    const r = partitionByType(baseTweaks, { p: "16", loading: "on" });
    expect(r.tweaks).toEqual({ p: "16" });
    expect(r.state).toEqual({ loading: "on" });
  });

  it("ignores keys not in the schema", () => {
    const r = partitionByType(baseTweaks, { unknown: "x" });
    expect(r.tweaks).toEqual({});
    expect(r.state).toEqual({});
  });
});

describe("isDivergent", () => {
  it("missing snapshot is divergence", () => {
    expect(
      isDivergent(baseTweaks, { variantId: "01-default", tweaks: {} }, null),
    ).toBe(true);
  });

  it("matching default-vs-default is not divergence", () => {
    expect(
      isDivergent(
        baseTweaks,
        { variantId: "01-default", tweaks: { p: "8" } },
        { variantId: "01-default", tweaks: {} },
      ),
    ).toBe(false);
  });

  it("state values are excluded from divergence", () => {
    expect(
      isDivergent(
        baseTweaks,
        { variantId: "01-default", tweaks: {} },
        { variantId: "01-default", tweaks: {} },
      ),
    ).toBe(false);
  });
});
