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

describe("applyTweaksToIframe – per-tweak data-attribute", () => {
  it("writes data-{id} for a select tweak using the resolved option value", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      {
        id: "card-density",
        type: "select",
        label: "Card density",
        options: [
          { label: "Cozy", value: "cozy" },
          { label: "Comfy", value: "comfy" },
        ],
        discardReason: "production ships one density",
      },
    ];
    applyTweaksToIframe(iframe, tweaks, { "card-density": "comfy" });
    expect(attrs.get("data-card-density")).toBe("comfy");
  });

  it("resolves a select label down to its value for the data-attribute", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      {
        id: "density",
        type: "select",
        label: "Density",
        options: [{ label: "Cozy", value: "cozy" }],
        discardReason: "x",
      },
    ];
    applyTweaksToIframe(iframe, tweaks, { density: "Cozy" });
    expect(attrs.get("data-density")).toBe("cozy");
  });

  it("writes data-{id} for a toggle tweak using on/off mapping", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      {
        id: "ornament",
        type: "toggle",
        label: "Ornament",
        on: "on",
        off: "off",
        discardReason: "x",
      },
    ];
    applyTweaksToIframe(iframe, tweaks, { ornament: "1" });
    expect(attrs.get("data-ornament")).toBe("on");
    applyTweaksToIframe(iframe, tweaks, { ornament: "0" });
    expect(attrs.get("data-ornament")).toBe("off");
  });

  it("writes data-{id} for a state tweak in addition to legacy data-state", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated", "loading"] },
    ];
    applyTweaksToIframe(iframe, tweaks, { row: "loading" });
    expect(attrs.get("data-row")).toBe("loading");
    expect(attrs.get("data-state")).toBe("loading");
  });

  it("does not write a data-attribute for slider, color, or text tweaks", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      { id: "pad", type: "slider", label: "Pad", target: "--pad", min: 0, max: 10, unit: "px" },
      { id: "accent", type: "color", label: "Accent", target: "--accent" },
      { id: "title", type: "text", label: "Title", target: "--title" },
    ];
    applyTweaksToIframe(iframe, tweaks, { pad: "4", accent: "#ff0000", title: "hi" });
    expect(attrs.has("data-pad")).toBe(false);
    expect(attrs.has("data-accent")).toBe(false);
    expect(attrs.has("data-title")).toBe(false);
  });

  it("falls back to the declared default when no value is stored", () => {
    const { iframe, attrs } = makeFakeIframe();
    const tweaks: Tweak[] = [
      {
        id: "density",
        type: "select",
        label: "Density",
        options: ["cozy", "roomy"],
        discardReason: "x",
      },
    ];
    applyTweaksToIframe(iframe, tweaks, {});
    expect(attrs.get("data-density")).toBe("cozy");
  });
});
