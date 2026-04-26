import { describe, it, expect } from "vitest";
import { computeDivergence } from "../approvals";
import type { Approval, Tweak } from "../types";

const tweaks: Tweak[] = [
  { id: "padding", type: "slider", label: "Padding", min: 0, max: 100, default: 16, target: "--p" },
  { id: "color", type: "color", label: "Color", default: "#ff0000", target: "--c" },
  {
    id: "view",
    type: "select",
    label: "View",
    options: ["a", "b"],
    default: "a",
    target: "--v",
    discardReason: "production locks the chosen view",
  },
  { id: "loading", type: "state", label: "Loading", options: ["on", "off"] },
];

const snapshot = (variantId: string | null, tweaks: Record<string, string> | null): Approval => ({
  variantId,
  tweaks,
  approvedAt: "2026-01-01T00:00:00Z",
});

describe("computeDivergence", () => {
  it("never-snapshotted surfaces are diverged", () => {
    const result = computeDivergence(tweaks, "01-default", {}, null);
    expect(result).toBe(true);
  });

  it("dense current matching dense default snapshot is approved", () => {
    const snap = snapshot("01-default", {});
    // Both sides expand to the same defaults via the schema.
    const result = computeDivergence(tweaks, "01-default", {}, snap);
    expect(result).toBe(false);
  });

  it("variant id mismatch flags divergence", () => {
    const snap = snapshot("01-default", {});
    const result = computeDivergence(tweaks, "02-other", {}, snap);
    expect(result).toBe(true);
  });

  it("user-changed tweak flags divergence against default snapshot", () => {
    const snap = snapshot("01-default", {});
    const result = computeDivergence(tweaks, "01-default", { padding: "32" }, snap);
    expect(result).toBe(true);
  });

  it("user value matching snapshot value is approved", () => {
    const snap = snapshot("01-default", { padding: "32" });
    const result = computeDivergence(tweaks, "01-default", { padding: "32" }, snap);
    expect(result).toBe(false);
  });

  it("state values do not factor into divergence", () => {
    const snap = snapshot("01-default", {});
    const result = computeDivergence(tweaks, "01-default", { loading: "on" }, snap);
    expect(result).toBe(false);
  });

  it("snapshot key removed from current schema does not flag", () => {
    const reducedTweaks = tweaks.filter((t) => t.id !== "padding");
    const snap = snapshot("01-default", { padding: "32" });
    const result = computeDivergence(reducedTweaks, "01-default", {}, snap);
    expect(result).toBe(false);
  });
});
