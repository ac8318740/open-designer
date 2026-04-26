import type { Approval, Approvals, Surface, Tweak } from "./types";
import { isDivergent } from "./surface-state";

// On-disk approval keys use "tokens/<id>" for the tokens-kind surfaces, even
// though the on-disk path under DATA_ROOT is `/preview/`. The key was named
// "tokens" first; the surface-kind rename caught up to it in v2.
export function approvalKey(surface: Pick<Surface, "kind" | "id">): string {
  return `${surface.kind === "page" ? "pages" : "tokens"}/${surface.id}`;
}

export function lookupApproval(
  approvals: Approvals | null,
  surface: Pick<Surface, "kind" | "id">,
): Approval | null {
  if (!approvals) return null;
  return approvals.surfaces[approvalKey(surface)] ?? null;
}

// A surface is diverged when there is no snapshot to compare against, or when
// the current (variantId, tweak values) pair differs from the snapshot. The
// comparison densifies both sides through the surface's tweak schema – see
// `isDivergent` in surface-state.ts for why.
export function computeDivergence(
  surfaceTweaks: Tweak[],
  currentVariantId: string | null,
  currentTweaks: Record<string, string>,
  snapshot: Approval | null,
): boolean {
  return isDivergent(
    surfaceTweaks,
    { variantId: currentVariantId, tweaks: currentTweaks },
    snapshot,
  );
}

export async function loadApprovals(dsName: string): Promise<Approvals> {
  try {
    const r = await fetch(`/data/design-systems/${dsName}/approvals.json`);
    if (!r.ok) return { schemaVersion: 2, surfaces: {} };
    const j = (await r.json()) as Approvals;
    if (!j || typeof j !== "object" || !j.surfaces) {
      return { schemaVersion: 2, surfaces: {} };
    }
    return j;
  } catch {
    return { schemaVersion: 2, surfaces: {} };
  }
}
