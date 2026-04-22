export interface TweakSelectOption {
  label: string;
  value: string;
}

export type TweakType = "select" | "color" | "slider" | "toggle" | "text" | "state";

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

export interface VariantEntry {
  id: string;
  file: string;
  label?: string;
  tweaks?: Tweak[];
}

export interface Page {
  id: string;
  label?: string;
  tweaks?: Tweak[];
  variants: VariantEntry[];
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

export interface DesignIndex {
  design?: string;
  // Legacy `project` field kept so older index.json files still parse. New
  // designs write `design`. Read code should prefer `design ?? project`.
  project?: string;
  designSystem?: string;
  updated?: string;
  tweaks?: Tweak[]; // design-level tweaks
  pages?: Page[];        // new shape
  drafts?: VariantEntry[]; // legacy shape, read-only
  chosen?: Chosen | LegacyChosen;
}

// Post-normalize shape. `chosen` is narrowed to the new `Chosen` form, and
// `drafts` is dropped because `pages` is the only source of truth after
// normalize. Only the raw fetch boundary should handle `DesignIndex`.
export interface NormalizedIndex extends Omit<DesignIndex, "chosen" | "drafts"> {
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

export interface DesignEntry {
  design: string;
  index: DesignIndex;
}

// Design system types -------------------------------------------------------

export interface DesignSystemManifest {
  name: string;
  description?: string;
  extends?: string;
  createdAt?: string;
  updatedAt?: string;
  shippedAt?: string;
  shippedTo?: string;
}

export interface DesignSystemIndexPages {
  designSystem?: string;
  updated?: string;
  pages?: Page[];
}

export interface DesignSystemEntry {
  name: string;
  manifest: DesignSystemManifest;
  pages: Page[];
}

export type ViewerMode = "designs" | "design-systems";
