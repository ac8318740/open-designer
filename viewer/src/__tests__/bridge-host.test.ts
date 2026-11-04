import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeHost } from "../bridge/host";
import type { FrameMessage, InitPayload } from "../bridge/protocol";

const INIT: InitPayload = {
  tokens: [],
  tweaks: { vars: {}, attrs: {} },
  picker: false,
  keys: ["mod+shift+k"],
  marks: [],
};

const selectionItem = {
  id: 1,
  selector: "#card",
  rect: { x: 0, y: 0, width: 10, height: 10 },
  html: "<div id=card></div>",
  text: "Card",
  styles: { color: "red" },
};

let win: { postMessage: ReturnType<typeof vi.fn> };
let loadListener: () => void;
let frame: {
  contentWindow: typeof win;
  addEventListener: (t: "load", fn: () => void) => void;
  setAttribute: ReturnType<typeof vi.fn>;
};
let clock: number;
let queued: Array<() => void>;
let received: FrameMessage[];
let warn: ReturnType<typeof vi.fn>;
let onClosed: ReturnType<typeof vi.fn>;
let onVersionMismatch: ReturnType<typeof vi.fn>;
let host: BridgeHost;
let sessionCounter: number;

beforeEach(() => {
  win = { postMessage: vi.fn() };
  frame = {
    contentWindow: win,
    addEventListener: (_t, fn) => {
      loadListener = fn;
    },
    setAttribute: vi.fn(),
  };
  clock = 0;
  queued = [];
  received = [];
  warn = vi.fn();
  onClosed = vi.fn();
  onVersionMismatch = vi.fn();
  sessionCounter = 0;
  host = new BridgeHost({
    frame,
    onMessage: (m) => received.push(m),
    onClosed,
    onVersionMismatch,
    now: () => clock,
    schedule: (fn) => queued.push(fn),
    warn,
    newSession: () => `s${++sessionCounter}`,
  });
});

const flush = () => queued.splice(0).forEach((fn) => fn());
const fromFrame = (data: unknown, extra: Partial<{ source: unknown; origin: string }> = {}) =>
  host.receive({ source: win, origin: "null", data, ...extra });
const ready = (extra: Record<string, unknown> = {}) =>
  fromFrame({ od: 1, type: "ready", page: "/a.html", variant: null, capabilities: [], ...extra });
const msg = (type: string, payload: Record<string, unknown> = {}, session = "s1") =>
  fromFrame({ od: 1, type, session, ...payload });

// A host-started load whose document has sent `ready` and received `init`.
function openSession(init: InitPayload = INIT): void {
  host.load(() => {});
  loadListener();
  ready();
  host.init(init);
}

describe("bridge host – handshake", () => {
  it("sends nothing before ready, then answers ready with init on the session", () => {
    host.load(() => {});
    expect(host.send("tweaks", { vars: {}, attrs: {} })).toBe(false);
    ready();
    expect(received).toEqual([{ type: "ready", page: "/a.html", variant: null, capabilities: [] }]);
    expect(host.init(INIT)).toBe(true);
    expect(win.postMessage).toHaveBeenCalledWith({ ...INIT, od: 1, type: "init", session: "s1" }, "*");
  });

  it("accepts the ready that arrives before the load event", () => {
    host.load(() => {});
    ready();
    loadListener();
    expect(host.ready).toBe(true);
  });

  it("accepts only one ready per load", () => {
    host.load(() => {});
    ready();
    ready();
    expect(received.filter((m) => m.type === "ready")).toHaveLength(1);
  });

  it("reports a version mismatch on ready and sends nothing more", () => {
    host.load(() => {});
    ready({ od: 2 });
    expect(onVersionMismatch).toHaveBeenCalledTimes(1);
    expect(host.init(INIT)).toBe(false);
    expect(win.postMessage).not.toHaveBeenCalled();
  });
});

describe("bridge host – trust checks", () => {
  beforeEach(() => openSession());

  it("drops a message from another window", () => {
    msg("scroll", { x: 1, y: 2 });
    fromFrame({ od: 1, type: "key", session: "s1", combo: "mod+shift+k" }, { source: {} });
    flush();
    expect(received[received.length - 1]).toEqual({ type: "scroll", x: 1, y: 2 });
    expect(received.some((m) => m.type === "key")).toBe(false);
  });

  it("drops a message with a real origin", () => {
    fromFrame({ od: 1, type: "key", session: "s1", combo: "mod+shift+k" }, { origin: "http://127.0.0.1:5179" });
    expect(received).toHaveLength(1); // only the ready
  });

  it("drops a message over 256 KiB before validating it", () => {
    msg("error", { message: "x".repeat(256 * 1024) });
    expect(received).toHaveLength(1);
  });

  it("drops non-JSON payloads", () => {
    const cyclic: Record<string, unknown> = { od: 1, type: "key", session: "s1", combo: "mod+shift+k" };
    cyclic.self = cyclic;
    fromFrame(cyclic);
    expect(received).toHaveLength(1);
  });

  it("drops a wrong od and a stale session", () => {
    fromFrame({ od: 2, type: "key", session: "s1", combo: "mod+shift+k" });
    msg("key", { combo: "mod+shift+k" }, "s0");
    expect(received).toHaveLength(1);
  });

  it("warns once per session and never replies", () => {
    win.postMessage.mockClear();
    msg("key", { combo: "mod+shift+k" }, "s0");
    msg("key", { combo: "mod+shift+k" }, "s0");
    fromFrame({ od: 1, type: "key", session: "s1", combo: "mod+shift+k" }, { origin: "https://evil.test" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(win.postMessage).not.toHaveBeenCalled();
  });

  it("drops an unknown type silently", () => {
    msg("future-thing", { x: 1 });
    expect(received).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a key only when init listed its combo", () => {
    msg("key", { combo: "mod+shift+k" });
    msg("key", { combo: "mod+s" });
    expect(received.filter((m) => m.type === "key")).toEqual([{ type: "key", combo: "mod+shift+k" }]);
  });
});

describe("bridge host – shapes and limits", () => {
  it("drops selection while the picker is off", () => {
    openSession();
    msg("selection", { items: [selectionItem] });
    flush();
    expect(received.some((m) => m.type === "selection")).toBe(false);
  });

  it("accepts a valid selection while the picker is on and rejects a bad one", () => {
    openSession({ ...INIT, picker: true });
    msg("selection", { items: [{ ...selectionItem, html: "x".repeat(2049) }] });
    msg("selection", { items: [selectionItem], limit: true });
    flush();
    expect(received.filter((m) => m.type === "selection")).toEqual([
      { type: "selection", items: [selectionItem], limit: true },
    ]);
  });

  it("rejects a selector over 1 KiB and more than 20 items", () => {
    openSession({ ...INIT, picker: true });
    msg("selection", { items: [{ ...selectionItem, selector: "a".repeat(1025) }] });
    msg("selection", { items: Array.from({ length: 21 }, (_, i) => ({ ...selectionItem, id: i + 1 })) });
    flush();
    expect(received.some((m) => m.type === "selection")).toBe(false);
  });

  it("stops accepting selection after the frame turns the picker off", () => {
    openSession({ ...INIT, picker: true });
    msg("picker", { on: false });
    msg("selection", { items: [selectionItem] });
    flush();
    expect(host.picker).toBe(false);
    expect(received.map((m) => m.type)).toEqual(["ready", "picker"]);
  });

  it("truncates error messages to 2 KiB and clamps resize", () => {
    openSession();
    msg("error", { message: "e".repeat(5000) });
    msg("resize", { height: 1e9 });
    flush();
    const error = received.find((m) => m.type === "error") as { message: string };
    expect(error.message).toHaveLength(2048);
    expect(received.find((m) => m.type === "resize")).toEqual({ type: "resize", height: 20000 });
  });

  it("coalesces scroll per animation frame, keeping the latest", () => {
    openSession();
    msg("scroll", { x: 0, y: 1 });
    msg("scroll", { x: 0, y: 2 });
    flush();
    expect(received.filter((m) => m.type === "scroll")).toEqual([{ type: "scroll", x: 0, y: 2 }]);
  });
});

describe("bridge host – rate limit", () => {
  it("allows a burst of 100, then refills at 50 per second", () => {
    openSession(); // the ready used one token
    for (let i = 0; i < 100; i++) msg("mark-click", { key: String(i) });
    expect(received.filter((m) => m.type === "mark-click")).toHaveLength(99);
    clock += 1000;
    for (let i = 0; i < 60; i++) msg("mark-click", { key: String(i) });
    expect(received.filter((m) => m.type === "mark-click")).toHaveLength(149);
  });

  it("counts messages from other windows against the limit", () => {
    openSession();
    for (let i = 0; i < 200; i++) fromFrame({}, { source: {} });
    msg("mark-click", { key: "k" });
    expect(received.some((m) => m.type === "mark-click")).toBe(false);
  });
});

describe("bridge host – load tracking", () => {
  it("closes the bridge and blanks the frame on a load it did not start", () => {
    openSession();
    loadListener(); // the frame navigated itself
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(frame.setAttribute).toHaveBeenCalledWith("srcdoc", "<!doctype html><title></title>");
    // The navigated document's ready and later messages are dropped.
    ready();
    msg("mark-click", { key: "k" });
    expect(received.map((m) => m.type)).toEqual(["ready"]);
    expect(host.send("picker", { on: true })).toBe(false);
  });

  it("ignores the blanking load and a stray load before any host load", () => {
    loadListener();
    expect(onClosed).not.toHaveBeenCalled();
    openSession();
    loadListener();
    loadListener(); // the srcdoc blank
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("reopens on the next host-started load with a new session", () => {
    openSession();
    loadListener();
    host.load(() => {});
    ready();
    host.init(INIT);
    expect(win.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "init", session: "s2" }), "*");
    msg("mark-click", { key: "old" }, "s1");
    msg("mark-click", { key: "new" }, "s2");
    expect(received.filter((m) => m.type === "mark-click")).toEqual([{ type: "mark-click", key: "new" }]);
  });
});

describe("bridge host – snapshot", () => {
  it("resolves with the frame's snapshot", async () => {
    openSession();
    const pending = host.requestSnapshot(300);
    expect(win.postMessage).toHaveBeenLastCalledWith({ od: 1, type: "snapshot-request", session: "s1" }, "*");
    msg("snapshot", { scroll: { x: 0, y: 40 }, app: { tab: 2 } });
    await expect(pending).resolves.toEqual({ type: "snapshot", scroll: { x: 0, y: 40 }, app: { tab: 2 } });
  });

  it("resolves null when the frame does not answer in time", async () => {
    vi.useFakeTimers();
    openSession();
    const pending = host.requestSnapshot(300);
    vi.advanceTimersByTime(300);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("rejects an app state over 64 KiB", async () => {
    vi.useFakeTimers();
    openSession();
    const pending = host.requestSnapshot(300);
    msg("snapshot", { scroll: { x: 0, y: 0 }, app: "a".repeat(64 * 1024 + 1) });
    vi.advanceTimersByTime(300);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});
