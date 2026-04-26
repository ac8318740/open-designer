// Open-designer viewer schema.
//
// Schema versioning
// -----------------
// Two on-disk shapes carry a `schemaVersion`:
//   - DesignIndex (designs/<name>/index.json) – v2 introduces the
//     `chosen.pages[*].state` sibling map next to `tweaks` and the
//     `discardReason` field on select/toggle tweaks + non-first variants.
//   - Approvals (design-systems/<ds>/approvals.json) – v2 (no on-disk
//     shape change in v2 itself; bumped alongside DesignIndex so a single
//     release line maps to one schema version).
// Files without `schemaVersion` are treated as v1 and migrated in-memory
// on read; the next write persists the v2 shape.
//
// Tweaks vs state
// ---------------
// A `select`/`toggle`/`slider`/`color`/`text` tweak is a designer
// decision: a finalize commits one value and the others drop from
// production (the finalize-discard test). A `state` "tweak" is *not* a
// designer decision – it's a runtime condition (loading/empty/errored)
// the production component must dispatch on. The on-disk shape keeps
// state values in `chosen.pages[*].state`, separate from `tweaks`, so
// approvals + integration treat the two distinctly.

export interface TweakSelectOption {
  label: string;
  value: string;
}

export type TweakType = "select" | "color" | "slider" | "toggle" | "text" | "state";

// How the slider/picker value maps to each target CSS variable.
// - "set" (default): every target gets the raw value.
// - "add": slider only. Each target = parseNumeric(tokensMap[target]) + value + unit.
// - "scale": slider only. Each target = parseNumeric(tokensMap[target]) * value + unit.
export type TweakTransform = "set" | "add" | "scale";

interface TweakBase {
  id: string;
  label: string;
  // target + targets are mutually exclusive. Single-target `target` stays
  // supported for back-compat; multi-target previews use `targets`.
  target?: string;
  targets?: string[];
  transform?: TweakTransform;
  default?: string | number | boolean;
}

export interface SliderTweak extends TweakBase {
  type: "slider";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface ColorTweak extends TweakBase {
  type: "color";
}

export interface TextTweak extends TweakBase {
  type: "text";
}

export interface SelectTweak extends TweakBase {
  type: "select";
  options?: Array<string | TweakSelectOption>;
  // Why the un-picked alternatives drop from production at finalize time.
  // Required by the finalize-discard test; missing values surface as a
  // schema warning and are treated as empty until the author fills them.
  discardReason: string;
}

export interface ToggleTweak extends TweakBase {
  type: "toggle";
  on?: string;
  off?: string;
  discardReason: string;
}

export interface StateTweak extends TweakBase {
  type: "state";
  options?: Array<string | TweakSelectOption>;
  // No discardReason – state values are runtime conditions, not designer
  // decisions, so the finalize-discard test does not apply.
}

export type Tweak =
  | SliderTweak
  | ColorTweak
  | TextTweak
  | SelectTweak
  | ToggleTweak
  | StateTweak;

export interface VariantEntry {
  id: string;
  file: string;
  label?: string;
  tweaks?: Tweak[];
  // Required on every variant past the first per page – the un-picked
  // variants drop from production at finalize time, and the reason is
  // surfaced in the finalize confirmation modal. Missing values warn at
  // load time and are treated as empty.
  discardReason?: string;
}

export interface Page {
  id: string;
  label?: string;
  tweaks?: Tweak[];
  variants: VariantEntry[];
}

export interface ChosenPage {
  variantId: string;
  // Designer decisions snapshotted at finalize. select/toggle/slider/color/text.
  tweaks: Record<string, string>;
  // Runtime conditions snapshotted at finalize. design-integrate must wire
  // these to the production component's state machine, not bake them into
  // :root overrides.
  state?: Record<string, string>;
}

export interface Chosen {
  finalizedAt: string;
  shippedAt?: string;
  pages: Record<string, ChosenPage>;
}

export interface DesignIndex {
  schemaVersion?: number;
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

// Design-system surfaces ----------------------------------------------------

// A DS surface is either a playable page (under pages/) or a static token
// demo (under preview/). Both are iframable, element-selectable, and
// reviewable. Tokens-kind surfaces have no variants and no file-local
// tweaks unless the author opts in via preview/index.json. The on-disk
// path stays `/preview/` – the kind is named "tokens" because that's
// what the optgroup label and approval key already say, and because
// authors think of these as token demos, not previews.
export type SurfaceKind = "page" | "tokens";

export interface Surface {
  kind: SurfaceKind;
  id: string;
  label: string;
  variants: VariantEntry[];
  file?: string; // tokens only – the default HTML file name
  tweaks?: Tweak[]; // page-level tweaks (pages and now tokens surfaces)
}

export interface Approval {
  variantId: string | null;
  tweaks: Record<string, string> | null;
  approvedAt: string;
}

export interface Approvals {
  schemaVersion: number;
  surfaces: Record<string, Approval>;
}

// Token-sync types ----------------------------------------------------------

export type TokensMap = Map<string, string>;

export interface SyncDivergenceRow {
  target: string;
  currentValue: string;
  tokensValue: string | null;
}

export interface SyncDivergence {
  tweakId: string;
  tweakLabel: string;
  transform: TweakTransform;
  // For "set": each row is the emitted value vs the tokens value.
  // For "add" / "scale": each row shows tokens value + emitted value; the
  // scalar delta/multiplier lives in `scalar`.
  rows: SyncDivergenceRow[];
  // Raw slider value for add/scale (e.g. "4", "1.25"); undefined for "set".
  scalar?: string;
  unit?: string;
}

// Launcher config (.open-designer/config.json) ------------------------------

export interface OpenDesignerConfig {
  defaultDesignSystem?: string;
}
