import { describe, it, expect } from "vitest";
import {
  applyApprovalsBody,
  applyFinalizeBody,
  sanitizeEntry,
  validateDesignIndex,
} from "../../../launcher/finalize.mjs";

describe("sanitizeEntry", () => {
  it("preserves a `state` map alongside tweaks", () => {
    const e = sanitizeEntry({
      variantId: "01-default",
      tweaks: { padding: "32" },
      state: { loading: "on" },
    });
    expect(e.variantId).toBe("01-default");
    expect(e.tweaks).toEqual({ padding: "32" });
    expect(e.state).toEqual({ loading: "on" });
  });

  it("omits state when not provided", () => {
    const e = sanitizeEntry({ variantId: "01-default", tweaks: {} });
    expect("state" in e).toBe(false);
  });

  it("ignores invalid state shapes", () => {
    const e = sanitizeEntry({ variantId: "x", tweaks: {}, state: "not-an-object" });
    expect("state" in e).toBe(false);
  });
});

describe("applyFinalizeBody", () => {
  it("rejects the legacy { chosen: {...} } shape", () => {
    const result = applyFinalizeBody(null, { chosen: { variantId: "x", tweaks: {} } });
    expect(result.error).toBe("unknown finalize payload");
  });

  it("supports markShipped against an existing chosen block", () => {
    const existing = {
      finalizedAt: "2026-01-01T00:00:00Z",
      pages: { log: { variantId: "01-default", tweaks: {} } },
    };
    const result = applyFinalizeBody(existing, { markShipped: "2026-04-26T10:00:00Z" });
    expect(result.error).toBeUndefined();
    expect(result.chosen?.shippedAt).toBe("2026-04-26T10:00:00Z");
  });

  it("rejects markShipped without an existing chosen block", () => {
    const result = applyFinalizeBody(null, { markShipped: "2026-04-26T10:00:00Z" });
    expect(result.error).toMatch(/markShipped requires/);
  });

  it("chosenPage carries state through to the persisted entry", () => {
    const result = applyFinalizeBody(null, {
      chosenPage: {
        pageId: "log",
        entry: { variantId: "01-default", tweaks: { p: "8" }, state: { loading: "on" } },
      },
    });
    expect(result.error).toBeUndefined();
    const entry = result.chosen?.pages?.log;
    expect(entry?.state).toEqual({ loading: "on" });
  });
});

describe("applyApprovalsBody", () => {
  it("accepts surfaceKind=tokens (new) and surfaceKind=preview (legacy)", () => {
    const a = applyApprovalsBody(null, {
      action: "set",
      surfaceKind: "tokens",
      surfaceId: "components",
    });
    expect(a.error).toBeUndefined();
    expect(Object.keys(a.approvals!.surfaces)).toContain("tokens/components");

    const b = applyApprovalsBody(null, {
      action: "set",
      surfaceKind: "preview",
      surfaceId: "components",
    });
    expect(b.error).toBeUndefined();
    expect(Object.keys(b.approvals!.surfaces)).toContain("tokens/components");
  });

  it("rejects unknown surfaceKind", () => {
    const r = applyApprovalsBody(null, {
      action: "set",
      surfaceKind: "weird",
      surfaceId: "x",
    });
    expect(r.error).toBe("invalid surfaceKind");
  });
});

describe("validateDesignIndex", () => {
  it("warns when a select tweak is missing discardReason", () => {
    const warnings = validateDesignIndex(
      {
        pages: [
          {
            id: "log",
            variants: [{ id: "01-default", file: "01.html" }],
            tweaks: [{ id: "view", type: "select", label: "View", options: ["a", "b"] }],
          },
        ],
      },
      "demo",
    );
    expect(warnings.some((w: string) => w.includes("discardReason"))).toBe(true);
  });

  it("warns on non-first variants without discardReason", () => {
    const warnings = validateDesignIndex(
      {
        pages: [
          {
            id: "log",
            variants: [
              { id: "01-default", file: "01.html" },
              { id: "02-other", file: "02.html" },
            ],
          },
        ],
      },
      "demo",
    );
    expect(warnings.some((w: string) => w.includes("02-other"))).toBe(true);
  });

  it("does not warn on state tweaks even though they cover similar shapes", () => {
    const warnings = validateDesignIndex(
      {
        pages: [
          {
            id: "log",
            variants: [{ id: "01-default", file: "01.html" }],
            tweaks: [
              { id: "loading", type: "state", label: "Loading", options: ["on", "off"] },
            ],
          },
        ],
      },
      "demo",
    );
    expect(warnings).toEqual([]);
  });
});
