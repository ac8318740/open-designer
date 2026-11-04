// OpenDesigner bridge protocol, version 1. Shared shapes for the host
// (bridge/host.ts) and the in-frame script (bridge/frame.ts). The frame
// imports types only, so its build stays one standalone file.

export const OD_VERSION = 1;
// Size cap on one message, measured as JSON characters before any validation.
export const MAX_MESSAGE_CHARS = 256 * 1024;
export const MAX_SELECTIONS = 20;
export const HTML_LIMIT = 2048;
export const TEXT_LIMIT = 200;
export const SELECTOR_LIMIT = 1024;
export const PROPS_LIMIT = 8 * 1024;
export const SNAPSHOT_APP_LIMIT = 64 * 1024;
export const ERROR_MESSAGE_LIMIT = 2048;
export const RESIZE_MAX = 20000;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionComponent {
  name: string;
  source?: string;
  props?: Record<string, unknown>;
  propsTruncated?: boolean;
  fixture?: string;
}

// One element the user picked in the frame. Every field is untrusted.
export interface Selection {
  id: number;
  selector: string;
  rect: Rect;
  html: string;
  text: string;
  styles: Record<string, string>;
  component?: SelectionComponent;
}

export interface TokenSheet {
  name: string;
  css: string;
}

export interface TweakPayload {
  vars: Record<string, string>;
  attrs: Record<string, string>;
}

export interface Mark {
  key: string;
  label: number;
  selector: string;
}

export interface Restore {
  scroll?: { x: number; y: number };
  app?: unknown;
  selections?: string[];
}

export interface InitPayload {
  tokens: TokenSheet[];
  tweaks: TweakPayload;
  picker: boolean;
  keys: string[];
  marks: Mark[];
  restore?: Restore;
}

// Frame-to-host messages after validation, without the envelope.
export type FrameMessage =
  | { type: "ready"; page: string; variant: string | null; capabilities: string[] }
  | { type: "applied"; background: string | null; stateRules: boolean }
  | { type: "selection"; items: Selection[]; limit?: true }
  | { type: "picker"; on: false }
  | { type: "navigate"; page: string; variant?: string }
  | { type: "scroll"; x: number; y: number }
  | { type: "resize"; height: number }
  | { type: "key"; combo: string }
  | { type: "revealed"; found: boolean; rect?: Rect }
  | { type: "mark-click"; key: string }
  | { type: "snapshot"; scroll: { x: number; y: number }; app?: unknown }
  | { type: "error"; message: string; source?: string; line?: number };
