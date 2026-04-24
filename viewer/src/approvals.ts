import type { Approval, Approvals, Surface } from "./types";

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

// A surface is diverged when there is no snapshot to compare against, or
// when the current (variantId, touched tweaks) pair differs from the
// snapshot. Untouched tweaks expand to fallback defaults we don't want to
// persist into approvals.json, so divergence ignores them: the comparison
// key set is the union of the snapshot's keys and the user's current touched
// keys. Every key in the union must match, and a touched key absent from the
// snapshot counts as a new user-introduced difference.
export function computeDivergence(
  surface: Surface,
  currentVariantId: string | null,
  currentTweaks: Record<string, string>,
  touched: ReadonlySet<string>,
  snapshot: Approval | null,
): boolean {
  void surface;
  if (!snapshot) return true;
  if ((snapshot.variantId ?? null) !== (currentVariantId ?? null)) return true;
  const snapshotTweaks = snapshot.tweaks ?? {};
  const keys = new Set<string>([...Object.keys(snapshotTweaks), ...touched]);
  for (const key of keys) {
    const snapValue = snapshotTweaks[key];
    const currValue = currentTweaks[key];
    if (snapValue === undefined) return true; // user touched a key not in the snapshot
    if (currValue === undefined) return true; // snapshotted tweak no longer present
    if (snapValue !== currValue) return true;
  }
  return false;
}

export async function loadApprovals(dsName: string): Promise<Approvals> {
  try {
    const r = await fetch(`/data/design-systems/${dsName}/approvals.json`);
    if (!r.ok) return { schemaVersion: 1, surfaces: {} };
    const j = (await r.json()) as Approvals;
    if (!j || typeof j !== "object" || !j.surfaces) {
      return { schemaVersion: 1, surfaces: {} };
    }
    return j;
  } catch {
    return { schemaVersion: 1, surfaces: {} };
  }
}
