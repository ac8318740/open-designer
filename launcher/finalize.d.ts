// Ambient types for the shared .mjs module. The runtime implementation lives
// in finalize.mjs so the zero-dep launcher can import it without a build.

export function isValidDesignName(name: string): boolean;

export interface ChosenEntry {
  variantId: string;
  tweaks: Record<string, unknown>;
}

export interface ChosenBlock {
  finalizedAt: string;
  shippedAt?: string;
  pages: Record<string, ChosenEntry>;
}

export function sanitizeEntry(entry: unknown): ChosenEntry;

export function normalizeChosen(existing: unknown): ChosenBlock | null;

export function applyFinalizeBody(
  existing: unknown,
  body: Record<string, unknown>,
): { chosen?: ChosenBlock | null; error?: string };
