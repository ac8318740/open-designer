// Host side of the bridge: owns one sandboxed frame, runs the trust checks on
// every incoming message, tracks loads, and posts host-to-frame messages.
// The host never touches the frame's document.

import {
  ERROR_MESSAGE_LIMIT,
  HTML_LIMIT,
  MAX_MESSAGE_CHARS,
  MAX_SELECTIONS,
  OD_VERSION,
  PROPS_LIMIT,
  RESIZE_MAX,
  SELECTOR_LIMIT,
  SNAPSHOT_APP_LIMIT,
  TEXT_LIMIT,
  type FrameMessage,
  type InitPayload,
  type Rect,
  type Selection,
} from "./protocol";

export interface FrameLike {
  readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
  addEventListener(type: "load", listener: () => void): void;
  setAttribute(name: string, value: string): void;
}

export interface IncomingEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

export interface BridgeHostOptions {
  frame: FrameLike;
  onMessage: (msg: FrameMessage) => void;
  // A load the host did not start; the frame is already blanked.
  onClosed?: () => void;
  // `ready` arrived with a different `od`; the frame renders without interaction.
  onVersionMismatch?: () => void;
  now?: () => number;
  // Runs coalesced messages once per animation frame.
  schedule?: (fn: () => void) => void;
  warn?: (message: string) => void;
  newSession?: () => string;
}

export type Snapshot = Extract<FrameMessage, { type: "snapshot" }>;

const RATE_PER_SECOND = 50;
const RATE_BURST = 100;
const COALESCED = new Set(["selection", "scroll", "resize"]);
const BLANK_DOC = "<!doctype html><title></title>";

export class BridgeHost {
  private readonly opts: Required<BridgeHostOptions>;
  private session: string | null = null;
  private open = false;
  private readySeen = false;
  private expectLoad = false;
  private pickerOn = false;
  private keys = new Set<string>();
  private warnedSession: string | null | undefined = undefined;
  private tokens = RATE_BURST;
  private refilledAt: number;
  private pending = new Map<string, FrameMessage>();
  private flushScheduled = false;
  private snapshotWaiter: ((s: Snapshot | null) => void) | null = null;

  constructor(options: BridgeHostOptions) {
    this.opts = {
      onClosed: () => {},
      onVersionMismatch: () => {},
      now: () => performance.now(),
      schedule: (fn) => requestAnimationFrame(() => fn()),
      warn: (m) => console.warn(m),
      // getRandomValues, not randomUUID: the viewer may run outside a secure context.
      newSession: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""),
      ...options,
    };
    this.refilledAt = this.opts.now();
    this.opts.frame.addEventListener("load", () => this.onFrameLoad());
  }

  // True once the current load has sent `ready` and the bridge is still open.
  get ready(): boolean {
    return this.open && this.readySeen;
  }

  get picker(): boolean {
    return this.pickerOn;
  }

  // Start a load the host owns. `start` sets `src` or `srcdoc`.
  load(start: () => void): void {
    this.resolveSnapshot(null);
    this.session = this.opts.newSession();
    this.open = true;
    this.readySeen = false;
    this.expectLoad = true;
    this.pending.clear();
    start();
  }

  init(payload: InitPayload): boolean {
    this.pickerOn = payload.picker;
    this.keys = new Set(payload.keys);
    return this.send("init", payload as unknown as Record<string, unknown>);
  }

  setPicker(on: boolean): void {
    this.pickerOn = on;
    this.send("picker", { on });
  }

  send(type: string, payload: Record<string, unknown> = {}): boolean {
    const win = this.opts.frame.contentWindow;
    if (!this.ready || !win) return false;
    if (type === "picker") this.pickerOn = payload.on === true;
    // The frame's origin is opaque, so "*" is the only possible target.
    // Nothing secret is ever sent.
    win.postMessage({ ...payload, od: OD_VERSION, type, session: this.session }, "*");
    return true;
  }

  // Ask the frame for its state; resolves null after `timeoutMs`.
  requestSnapshot(timeoutMs: number): Promise<Snapshot | null> {
    this.resolveSnapshot(null);
    if (!this.send("snapshot-request")) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.snapshotWaiter = resolve;
      setTimeout(() => this.resolveSnapshot(null), timeoutMs);
    });
  }

  receive(event: IncomingEvent): void {
    // 1. Rate limit.
    if (!this.takeToken()) return this.reject("over the rate limit");
    // 2. Identity: the frame's own window.
    if (event.source == null || event.source !== this.opts.frame.contentWindow) {
      return this.reject("wrong source window");
    }
    // 3. A sandboxed frame always has the opaque "null" origin.
    if (event.origin !== "null") return this.reject("non-null origin");
    // 4. Size, before anything reads the payload.
    if (!withinSize(event.data)) return this.reject("over 256 KiB");
    const data = event.data as Record<string, unknown>;
    // 5. Protocol version.
    if (data.od !== OD_VERSION) {
      if (data.type === "ready" && this.open && !this.readySeen) {
        this.open = false;
        this.opts.onVersionMismatch();
      }
      return this.reject("wrong od");
    }
    // 6. Session. `ready` precedes `init`, so it carries none.
    if (data.type === "ready" ? data.session !== undefined : data.session !== this.session) {
      return this.reject("stale session");
    }
    // 7. The bridge is open for this load, with one `ready` per load.
    if (!this.open || (data.type === "ready") === this.readySeen) {
      return this.reject("bridge closed for this load");
    }
    // 8. Shape and limits. Unknown types drop silently.
    if (typeof data.type !== "string" || !VALIDATORS[data.type]) return;
    const msg = VALIDATORS[data.type](data, this.keys);
    if (!msg) return this.reject(`bad ${data.type} shape`);
    // Refused but not a trust failure, so no warning: a restore can race the toggle.
    if (msg.type === "selection" && !this.pickerOn) return;

    if (msg.type === "ready") this.readySeen = true;
    if (msg.type === "picker") this.pickerOn = false;
    if (msg.type === "snapshot") return this.resolveSnapshot(msg);
    if (COALESCED.has(msg.type)) return this.coalesce(msg);
    this.opts.onMessage(msg);
  }

  private onFrameLoad(): void {
    if (this.expectLoad) {
      this.expectLoad = false;
      return;
    }
    if (!this.open) return;
    // The frame navigated itself. Stop listening and blank it.
    this.open = false;
    this.pending.clear();
    this.resolveSnapshot(null);
    this.opts.frame.setAttribute("srcdoc", BLANK_DOC);
    this.opts.onClosed();
  }

  private coalesce(msg: FrameMessage): void {
    this.pending.set(msg.type, msg);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.opts.schedule(() => {
      this.flushScheduled = false;
      const batch = [...this.pending.values()];
      this.pending.clear();
      for (const m of batch) if (this.open) this.opts.onMessage(m);
    });
  }

  private resolveSnapshot(s: Snapshot | null): void {
    const waiter = this.snapshotWaiter;
    this.snapshotWaiter = null;
    waiter?.(s);
  }

  private takeToken(): boolean {
    const now = this.opts.now();
    this.tokens = Math.min(RATE_BURST, this.tokens + ((now - this.refilledAt) / 1000) * RATE_PER_SECOND);
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  // One console warning per session; never a reply to the frame.
  private reject(reason: string): void {
    if (this.warnedSession === this.session) return;
    this.warnedSession = this.session;
    this.opts.warn(`[od] bridge dropped a frame message: ${reason}`);
  }
}

function withinSize(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" && json.length <= MAX_MESSAGE_CHARS;
  } catch {
    return false; // cycles, BigInt, and other non-JSON values
  }
}

// --- Shape validators ------------------------------------------------------

type Data = Record<string, unknown>;
type Validator = (d: Data, keys: ReadonlySet<string>) => FrameMessage | null;

const isStr = (v: unknown, max = Infinity): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const optStr = (v: unknown, max = Infinity) => v === undefined || isStr(v, max);

function rect(v: unknown): Rect | null {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.width) || !isNum(v.height)) return null;
  return { x: v.x, y: v.y, width: v.width, height: v.height };
}

function selection(v: unknown): Selection | null {
  if (!isObj(v) || !isNum(v.id) || !isStr(v.selector, SELECTOR_LIMIT)) return null;
  const r = rect(v.rect);
  if (!r || !isStr(v.html, HTML_LIMIT) || !isStr(v.text, TEXT_LIMIT) || !isObj(v.styles)) return null;
  const styles: Record<string, string> = {};
  for (const [k, s] of Object.entries(v.styles)) {
    if (!isStr(s)) return null;
    styles[k] = s;
  }
  const out: Selection = { id: v.id, selector: v.selector, rect: r, html: v.html, text: v.text, styles };
  if (v.component !== undefined) {
    const c = v.component;
    if (!isObj(c) || !isStr(c.name, 200) || !optStr(c.source, 1024) || !optStr(c.fixture, 1024)) return null;
    if (c.props !== undefined && (!isObj(c.props) || JSON.stringify(c.props).length > PROPS_LIMIT)) return null;
    out.component = {
      name: c.name,
      ...(c.source !== undefined ? { source: c.source as string } : {}),
      ...(c.props !== undefined ? { props: c.props as Record<string, unknown> } : {}),
      ...(c.propsTruncated === true ? { propsTruncated: true } : {}),
      ...(c.fixture !== undefined ? { fixture: c.fixture as string } : {}),
    };
  }
  return out;
}

const VALIDATORS: Record<string, Validator> = {
  ready: (d) => {
    if (!isStr(d.page, 1024) || !(d.variant == null || isStr(d.variant, 1024))) return null;
    if (!Array.isArray(d.capabilities) || !d.capabilities.every((c) => isStr(c, 64))) return null;
    return { type: "ready", page: d.page, variant: (d.variant as string) ?? null, capabilities: d.capabilities };
  },
  applied: (d) => {
    if (!(d.background === null || isStr(d.background, 200)) || typeof d.stateRules !== "boolean") return null;
    return { type: "applied", background: d.background, stateRules: d.stateRules };
  },
  selection: (d) => {
    if (!Array.isArray(d.items) || d.items.length > MAX_SELECTIONS) return null;
    if (d.limit !== undefined && d.limit !== true) return null;
    const items: Selection[] = [];
    for (const raw of d.items) {
      const s = selection(raw);
      if (!s) return null;
      items.push(s);
    }
    return { type: "selection", items, ...(d.limit ? { limit: true as const } : {}) };
  },
  picker: (d) => (d.on === false ? { type: "picker", on: false } : null),
  navigate: (d) => {
    if (!isStr(d.page, 1024) || !d.page || !optStr(d.variant, 1024)) return null;
    return { type: "navigate", page: d.page, ...(d.variant ? { variant: d.variant as string } : {}) };
  },
  scroll: (d) => (isNum(d.x) && isNum(d.y) ? { type: "scroll", x: d.x, y: d.y } : null),
  resize: (d) => (isNum(d.height) ? { type: "resize", height: Math.min(RESIZE_MAX, Math.max(0, d.height)) } : null),
  key: (d, keys) => (isStr(d.combo) && keys.has(d.combo) ? { type: "key", combo: d.combo } : null),
  revealed: (d) => {
    if (typeof d.found !== "boolean") return null;
    if (d.rect === undefined) return { type: "revealed", found: d.found };
    const r = rect(d.rect);
    return r ? { type: "revealed", found: d.found, rect: r } : null;
  },
  "mark-click": (d) => (isStr(d.key, 1024) ? { type: "mark-click", key: d.key } : null),
  snapshot: (d) => {
    if (!isObj(d.scroll) || !isNum(d.scroll.x) || !isNum(d.scroll.y)) return null;
    if (d.app !== undefined && JSON.stringify(d.app).length > SNAPSHOT_APP_LIMIT) return null;
    return {
      type: "snapshot",
      scroll: { x: d.scroll.x, y: d.scroll.y },
      ...(d.app !== undefined ? { app: d.app } : {}),
    };
  },
  error: (d) => {
    if (!isStr(d.message) || !optStr(d.source, 2048) || !(d.line === undefined || isNum(d.line))) return null;
    return {
      type: "error",
      message: d.message.slice(0, ERROR_MESSAGE_LIMIT),
      ...(d.source !== undefined ? { source: d.source as string } : {}),
      ...(d.line !== undefined ? { line: d.line as number } : {}),
    };
  },
};
