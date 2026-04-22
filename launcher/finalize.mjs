// Shared finalize merge logic for both the dev-time vite middleware
// (data-server.ts) and the zero-dep production launcher (serve.mjs).
//
// Kept as plain .mjs so serve.mjs can import without a build step;
// the vite middleware consumes it via allowJs.

/**
 * Validate a design name from a URL path. Rejects anything that could escape
 * the drafts directory – dot-dot segments, path separators, and any character
 * outside [A-Za-z0-9._-]. Returns true if safe.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidDesignName(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.includes("..")) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/**
 * @param {unknown} entry
 * @returns {{ variantId: string, tweaks: Record<string, unknown> }}
 */
export function sanitizeEntry(entry) {
  const e = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
  return {
    variantId: String(e.variantId ?? ""),
    tweaks: e.tweaks && typeof e.tweaks === "object" ? /** @type {Record<string, unknown>} */ (e.tweaks) : {},
  };
}

/**
 * Convert a persisted chosen block (possibly legacy single-variant shape) into
 * the new pages-keyed shape so the merge logic only deals with one form.
 *
 * @param {unknown} existing
 * @returns {null | { finalizedAt: string, shippedAt?: string, pages: Record<string, { variantId: string, tweaks: Record<string, unknown> }> }}
 */
export function normalizeChosen(existing) {
  if (!existing || typeof existing !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (existing);
  if (obj.pages && typeof obj.pages === "object") {
    return {
      finalizedAt: String(obj.finalizedAt ?? new Date().toISOString()),
      ...(obj.shippedAt ? { shippedAt: String(obj.shippedAt) } : {}),
      pages: { .../** @type {Record<string, any>} */ (obj.pages) },
    };
  }
  return {
    finalizedAt: String(obj.finalizedAt ?? new Date().toISOString()),
    ...(obj.shippedAt ? { shippedAt: String(obj.shippedAt) } : {}),
    pages: {
      main: {
        variantId: String(obj.variantId ?? ""),
        tweaks: obj.tweaks && typeof obj.tweaks === "object" ? /** @type {Record<string, unknown>} */ (obj.tweaks) : {},
      },
    },
  };
}

/**
 * Apply a finalize POST body against the existing chosen state.
 *
 * Accepted body shapes:
 *   { chosenPage: { pageId, entry: { variantId, tweaks } } }  – set one page
 *   { clearPage: pageId }                                     – clear one page
 *   { finalizeAll: { pages: { pageId: { variantId, tweaks } } } }  – replace
 *   { clearAll: true }                                        – drop chosen
 *   { chosen: {...} | null }                                  – legacy path,
 *     used by the integration skill to stamp shippedAt.
 *
 * Returns { chosen } on success (chosen is null to clear), or { error }.
 *
 * @param {unknown} existing  The current `chosen` field from index.json.
 * @param {Record<string, unknown>} body  The parsed POST body.
 * @returns {{ chosen?: object | null, error?: string }}
 */
export function applyFinalizeBody(existing, body) {
  const now = new Date().toISOString();
  const current = normalizeChosen(existing);

  if (body.clearAll === true) return { chosen: null };

  if (typeof body.clearPage === "string") {
    if (!current) return { chosen: null };
    delete current.pages[body.clearPage];
    if (Object.keys(current.pages).length === 0) return { chosen: null };
    current.finalizedAt = now;
    return { chosen: current };
  }

  if (body.chosenPage && typeof body.chosenPage === "object") {
    const cp = /** @type {{ pageId?: string, entry?: unknown }} */ (body.chosenPage);
    if (!cp.pageId || !cp.entry) return { error: "chosenPage requires pageId and entry" };
    const base = current ?? { finalizedAt: now, pages: {} };
    base.pages[cp.pageId] = sanitizeEntry(cp.entry);
    base.finalizedAt = now;
    return { chosen: base };
  }

  if (body.finalizeAll && typeof body.finalizeAll === "object") {
    const fa = /** @type {{ pages?: Record<string, unknown> }} */ (body.finalizeAll);
    if (!fa.pages || typeof fa.pages !== "object") {
      return { error: "finalizeAll requires pages map" };
    }
    const pages = /** @type {Record<string, { variantId: string, tweaks: Record<string, unknown> }>} */ ({});
    for (const [pageId, entry] of Object.entries(fa.pages)) {
      pages[pageId] = sanitizeEntry(entry);
    }
    // Empty pages collapses to cleared; matches clearPage's collapse behavior.
    if (Object.keys(pages).length === 0) return { chosen: null };
    const shippedAt = current?.shippedAt;
    return {
      chosen: {
        finalizedAt: now,
        ...(shippedAt ? { shippedAt } : {}),
        pages,
      },
    };
  }

  if ("chosen" in body) {
    const c = body.chosen;
    if (c === null) return { chosen: null };
    if (!c || typeof c !== "object") return { error: "missing chosen" };
    const obj = /** @type {Record<string, unknown>} */ (c);
    if (obj.pages && typeof obj.pages === "object") {
      const pages = /** @type {Record<string, { variantId: string, tweaks: Record<string, unknown> }>} */ ({});
      for (const [pageId, entry] of Object.entries(/** @type {Record<string, unknown>} */ (obj.pages))) {
        pages[pageId] = sanitizeEntry(entry);
      }
      return {
        chosen: {
          finalizedAt: String(obj.finalizedAt ?? now),
          ...(obj.shippedAt ? { shippedAt: String(obj.shippedAt) } : {}),
          pages,
        },
      };
    }
    const pageKey =
      current && Object.keys(current.pages)[0]
        ? Object.keys(current.pages)[0]
        : "main";
    return {
      chosen: {
        finalizedAt: String(obj.finalizedAt ?? now),
        ...(obj.shippedAt ? { shippedAt: String(obj.shippedAt) } : {}),
        pages: {
          [pageKey]: sanitizeEntry(obj),
        },
      },
    };
  }

  return { error: "unknown finalize payload" };
}
