export interface TweakSelectOption {
  label: string;
  value: string;
}

export type TweakType = "select" | "color" | "slider" | "toggle" | "text";

export interface Tweak {
  id: string;
  type: TweakType;
  label: string;
  target: string; // CSS variable name, e.g. "--cta-bg"
  default?: string | number | boolean;
  // select
  options?: Array<string | TweakSelectOption>;
  // slider
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // toggle
  on?: string;
  off?: string;
}

export interface DraftEntry {
  id: string;
  file: string;
  label?: string;
  tweaks?: Tweak[];
}

export interface Chosen {
  variantId: string;
  tweaks: Record<string, string>;
  finalizedAt: string;
  shippedAt?: string;
}

export interface DraftIndex {
  project: string;
  updated?: string;
  tweaks?: Tweak[]; // project-level tweaks, apply to every variant
  drafts: DraftEntry[];
  chosen?: Chosen;
}

export interface SelectionSnapshot {
  id: number;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  outerHTML: string;
  styles: Record<string, string>;
  element: HTMLElement;
}

export interface ProjectEntry {
  project: string;
  index: DraftIndex;
}
