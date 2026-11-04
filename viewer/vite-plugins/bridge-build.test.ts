import { describe, it, expect } from "vitest";
import { buildBridgeScript } from "./data-server";

describe("bridge build", () => {
  it("is one standalone classic script", async () => {
    const code = await buildBridgeScript();
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).toContain('"snapshot-request"');
    expect(() => new Function(code)).not.toThrow(); // parses as a classic script
  });
});
