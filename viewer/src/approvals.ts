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
    stripEmptyStateValues(j);
    return j;
  } catch {
    return { schemaVersion: 2, surfaces: {} };
  }
}

// Pre-0.7.0 approvals could carry state keys in `tweaks` whose value was the
// old "" sentinel ("unfiltered – stacked"). 0.7.0 partitioned state into its
// own map, but stale snapshots still surface here. Drop them so divergence
// math doesn't false-positive against the new first-option default. Persists
// on the next approval write.
function stripEmptyStateValues(approvals: Approvals): void {
  for (const surface of Object.values(approvals.surfaces)) {
    const t = surface.tweaks;
    if (!t) continue;
    for (const [k, v] of Object.entries(t)) {
      if (v === "") delete t[k];
    }
  }
}
