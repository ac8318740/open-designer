import { describe, it, expect } from "vitest";
import { defaultFor, tweakPayload } from "../tweaks";
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

describe("tweakPayload – state attribute", () => {
  it("sets data-state to the resolved value when a state tweak is declared", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated", "loading"] },
    ];
    attrs = tweakPayload(tweaks, { row: "loading" }).attrs;
    expect(attrs["data-state"]).toBe("loading");
  });

  it("falls back to the first option when no value is stored", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated", "loading"] },
    ];
    attrs = tweakPayload(tweaks, {}).attrs;
    expect(attrs["data-state"]).toBe("populated");
  });

  it("always emits data-state for a declared state tweak", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated"] },
    ];
    attrs = tweakPayload(tweaks, {}).attrs;
    expect(("data-state" in attrs)).toBe(true);
  });
});

describe("tweakPayload – per-tweak data-attribute", () => {
  it("writes data-{id} for a select tweak using the resolved option value", () => {
    let attrs: Record<string, string>;
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
    attrs = tweakPayload(tweaks, { "card-density": "comfy" }).attrs;
    expect(attrs["data-card-density"]).toBe("comfy");
  });

  it("resolves a select label down to its value for the data-attribute", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      {
        id: "density",
        type: "select",
        label: "Density",
        options: [{ label: "Cozy", value: "cozy" }],
        discardReason: "x",
      },
    ];
    attrs = tweakPayload(tweaks, { density: "Cozy" }).attrs;
    expect(attrs["data-density"]).toBe("cozy");
  });

  it("writes data-{id} for a toggle tweak using on/off mapping", () => {
    let attrs: Record<string, string>;
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
    attrs = tweakPayload(tweaks, { ornament: "1" }).attrs;
    expect(attrs["data-ornament"]).toBe("on");
    attrs = tweakPayload(tweaks, { ornament: "0" }).attrs;
    expect(attrs["data-ornament"]).toBe("off");
  });

  it("writes data-{id} for a state tweak in addition to legacy data-state", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      { id: "row", type: "state", label: "Row", options: ["populated", "loading"] },
    ];
    attrs = tweakPayload(tweaks, { row: "loading" }).attrs;
    expect(attrs["data-row"]).toBe("loading");
    expect(attrs["data-state"]).toBe("loading");
  });

  it("does not write a data-attribute for slider, color, or text tweaks", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      { id: "pad", type: "slider", label: "Pad", target: "--pad", min: 0, max: 10, unit: "px" },
      { id: "accent", type: "color", label: "Accent", target: "--accent" },
      { id: "title", type: "text", label: "Title", target: "--title" },
    ];
    attrs = tweakPayload(tweaks, { pad: "4", accent: "#ff0000", title: "hi" }).attrs;
    expect(("data-pad" in attrs)).toBe(false);
    expect(("data-accent" in attrs)).toBe(false);
    expect(("data-title" in attrs)).toBe(false);
  });

  it("falls back to the declared default when no value is stored", () => {
    let attrs: Record<string, string>;
    const tweaks: Tweak[] = [
      {
        id: "density",
        type: "select",
        label: "Density",
        options: ["cozy", "roomy"],
        discardReason: "x",
      },
    ];
    attrs = tweakPayload(tweaks, {}).attrs;
    expect(attrs["data-density"]).toBe("cozy");
  });
});
