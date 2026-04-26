import { describe, it, expect } from "vitest";
import { applyTweaksToIframe, defaultFor } from "../tweaks";
import type { Tweak } from "../types";

describe("defaultFor – state tweak", () => {
  it("returns the first option when no default is declared", () => {
    const tweak: Tweak = {
      id: "row",
      type: "state",
      label: "Row",
      options: ["populated", "loading", "errored"],
    };
    expect(defaultFor(tweak)).toBe("populated");
  });

  it("respects an explicit declared default", () => {
    const tweak: Tweak = {
      id: "row",
      type: "state",
      label: "Row",
      options: ["populated", "loading"],
      default: "loading",
    };
    expect(defaultFor(tweak)).toBe("loading");
  });

  it("supports object-shaped options", () => {
    const tweak: Tweak = {
      id: "row",
      type: "state",
      label: "Row",
      options: [
        { label: "Populated", value: "populated" },
        { label: "Loading", value: "loading" },
      ],
    };
    expect(defaultFor(tweak)).toBe("populated");
  });
});

// Build the smallest iframe stub that satisfies applyTweaksToIframe: a
// documentElement with attribute methods, a head that swallows appendChild,
// and a getElementById/createElement pair so the injected <style> roundtrips.
function makeFakeIframe(): {
  iframe: HTMLIFrameElement;
  attrs: Map<string, string>;
} {
  const attrs = new Map<string, string>();
  const documentElement = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
  };
  const styleStub = { id: "", textContent: "" };
  const doc = {
    documentElement,
    head: { appendChild: (_n: unknown) => undefined },
    getElementById: (_id: string) => null,
    createElement: (_tag: string) => styleStub,
  };
  const iframe = { contentDocument: doc } as unknown as HTMLIFrameElement;
  return { iframe, attrs };
}

describe("applyTweaksToIframe – state attribute", () => {
  it("sets data-state to the resolved value when a state tweak is declared", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated", "loading"] },
    ];
    applyTweaksToIframe(iframe, tweaks, { row: "loading" });
    expect(attrs.get("data-state")).toBe("loading");
  });

  it("falls back to the first option when no value is stored", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated", "loading"] },
    ];
    applyTweaksToIframe(iframe, tweaks, {});
    expect(attrs.get("data-state")).toBe("populated");
  });

  it("never removes data-state for a declared state tweak", () => {
    const { iframe, attrs } = makeFakeIframe();
    attrs.set("data-state", "preset");
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated"] },
    ];
    applyTweaksToIframe(iframe, tweaks, {});
    expect(attrs.has("data-state")).toBe(true);
  });
});
