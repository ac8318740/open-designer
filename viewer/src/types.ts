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

export interface Page {
  id: string;
  label?: string;
  tweaks?: Tweak[];
  variants: DraftEntry[];
}

export interface ChosenPage {
  variantId: string;
  tweaks: Record<string, string>;
}

export interface Chosen {
  finalizedAt: string;
  shippedAt?: string;
  pages: Record<string, ChosenPage>;
}

export interface DraftIndex {
  project: string;
  updated?: string;
  tweaks?: Tweak[]; // project-level tweaks, apply to every variant
  pages?: Page[];        // new shape
  drafts?: DraftEntry[]; // legacy shape, read-only
  chosen?: Chosen | LegacyChosen;
}

// Post-normalize shape. `chosen` is narrowed to the new `Chosen` form, and
// `drafts` is dropped because `pages` is the only source of truth after
// normalize. Only the raw fetch boundary should handle `DraftIndex`.
export interface NormalizedIndex extends Omit<DraftIndex, "chosen" | "drafts"> {
  pages: Page[];
  chosen?: Chosen;
}

// Legacy pre-pages chosen block. Read-only – the viewer normalizes it
// to the new Chosen shape on load. Never write this shape.
export interface LegacyChosen {
  variantId: string;
  tweaks: Record<string, string>;
  finalizedAt: string;
  shippedAt?: string;
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
