// Shared launcher write logic for both the dev-time vite middleware
// (data-server.ts) and the zero-dep production launcher (serve.mjs).
//
// Kept as plain .mjs so serve.mjs can import without a build step;
// the vite middleware consumes it via allowJs.

import { join, normalize, sep } from "node:path";

/**
 * Validate a name from a URL path. Rejects anything that could escape the
 * parent directory – dot-dot segments, path separators, and any character
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
 * Join a user-supplied relative path onto a trusted root, refusing anything
 * that escapes the root. Accepts URL-encoded input; strips a trailing query.
 * Returns the resolved absolute path, or null if unsafe.
 *
 * @param {string} root  Absolute root directory, no trailing separator.
 * @param {string} relPath  Untrusted relative path (may be URL-encoded).
 * @returns {string | null}
 */
export function safeJoin(root, relPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relPath.replace(/\?.*$/, ""));
  } catch {
    return null;
  }
  const joined = normalize(join(root, decoded));
  if (!joined.startsWith(root + sep) && joined !== root) return null;
  return joined;
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

// --- Design-system promote -------------------------------------------------

const TOKEN_NAME_RE = /^--[A-Za-z0-9_-]+$/;
// Reject anything that could terminate the :root block or inject extra rules.
// The value is inserted verbatim into the CSS declaration, so it must not
// contain `;`, `{`, `}`, newlines, or a comment sequence.
const VALUE_REJECT_RE = /[;{}\n\r]|\/\*|\*\//;

/**
 * Patch a CSS variable declaration at `:root` in a tokens.css string. If the
 * target variable exists in a top-level `:root { … }` block, replace its
 * value. Otherwise, append it to the last `:root { … }` block, or create a
 * new one at the end if none exists.
 *
 * The function is deliberately conservative – it only edits top-level
 * `:root { … }`, never nested selectors or media queries.
 *
 * @param {string} css
 * @param {string} target  e.g. "--ds-primary"
 * @param {string} value   e.g. "#1234ab"
 * @returns {string}
 */
export function patchTokenInCss(css, target, value) {
  if (!TOKEN_NAME_RE.test(target)) throw new Error(`invalid token name: ${target}`);
  if (VALUE_REJECT_RE.test(value)) throw new Error(`invalid token value`);

  // Find top-level :root { … } blocks. A scanner that ignores nested braces
  // would be overkill here – :root blocks don't nest in practice, so we walk
  // occurrences of `:root` and bracket-match the following `{…}`.
  const roots = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf(":root", i);
    if (idx === -1) break;
    // Skip leading-whitespace/selector-prefix checks: `:root` only begins a
    // selector if it's preceded by start-of-file, `}`, comment close, or a
    // sibling selector character. Keep it simple – check that the preceding
    // non-space char is one of those.
    let j = idx - 1;
    while (j >= 0 && /\s/.test(css[j])) j--;
    const prev = j >= 0 ? css[j] : "{";
    if (prev !== "}" && prev !== "{" && prev !== "," && prev !== "/" && j !== -1) {
      i = idx + 5;
      continue;
    }
    // Find the opening `{` after `:root` (allow for selector list like `:root, ...`).
    const open = css.indexOf("{", idx);
    if (open === -1) break;
    // Bracket-match.
    let depth = 1;
    let k = open + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      k++;
    }
    if (depth === 0) {
      roots.push({ start: open + 1, end: k - 1 }); // body between `{` and `}`
    }
    i = k;
  }

  if (roots.length === 0) {
    // No :root yet – append one.
    const trailing = css.endsWith("\n") ? "" : "\n";
    return `${css}${trailing}\n:root {\n  ${target}: ${value};\n}\n`;
  }

  // Try to find the target in any root block and replace it.
  const decl = new RegExp(
    `(^|[;{\\s])${target.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}\\s*:\\s*[^;}]+;?`,
    "m",
  );
  for (const root of roots) {
    const body = css.slice(root.start, root.end);
    if (decl.test(body)) {
      const next = body.replace(decl, (match, pre) => `${pre}${target}: ${value};`);
      return css.slice(0, root.start) + next + css.slice(root.end);
    }
  }

  // Not present – append to the last :root block.
  const last = roots[roots.length - 1];
  const body = css.slice(last.start, last.end);
  const needsSemi = body.trim().length > 0 && !body.trimEnd().endsWith(";");
  const insert = `${needsSemi ? ";" : ""}\n  ${target}: ${value};\n`;
  return css.slice(0, last.end) + insert + css.slice(last.end);
}

/**
 * Apply a promote POST body against the DS's tokens.css contents. Returns the
 * new CSS on success or an error message.
 *
 * @param {string} currentCss
 * @param {Record<string, unknown>} body
 * @returns {{ css?: string, error?: string }}
 */
export function applyPromoteBody(currentCss, body) {
  const target = typeof body.target === "string" ? body.target : "";
  const value = typeof body.value === "string" ? body.value : "";
  if (!TOKEN_NAME_RE.test(target)) return { error: "invalid target token name" };
  if (!value) return { error: "missing value" };
  if (VALUE_REJECT_RE.test(value)) return { error: "invalid value" };
  try {
    return { css: patchTokenInCss(currentCss, target, value) };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)) };
  }
}

// --- Surface approvals ----------------------------------------------------

/**
 * Apply an approvals POST body against the existing approvals state. Returns
 * the merged approvals object on success, or an error message.
 *
 * Accepted body shapes:
 *   { action: "set", surfaceKind: "page"|"preview", surfaceId, variantId?, tweaks? }
 *   { action: "clear", surfaceKind: "page"|"preview", surfaceId }
 *
 * @param {unknown} current
 * @param {Record<string, unknown>} body
 * @returns {{ approvals?: { schemaVersion: number, surfaces: Record<string, unknown> }, error?: string }}
 */
export function applyApprovalsBody(current, body) {
  const surfaces =
    current && typeof current === "object" && /** @type {any} */ (current).surfaces
      ? { .../** @type {Record<string, unknown>} */ (/** @type {any} */ (current).surfaces) }
      : /** @type {Record<string, unknown>} */ ({});
  const approvals = { schemaVersion: 1, surfaces };
  const action = body?.action;
  const kind = body?.surfaceKind;
  const id = body?.surfaceId;
  if (!id || typeof id !== "string") return { error: "missing surfaceId" };
  if (kind !== "page" && kind !== "preview") return { error: "invalid surfaceKind" };
  const key = `${kind === "page" ? "pages" : "tokens"}/${id}`;
  if (action === "clear") {
    delete approvals.surfaces[key];
    return { approvals };
  }
  if (action === "set") {
    approvals.surfaces[key] = {
      variantId: body.variantId ?? null,
      tweaks: body.tweaks ?? null,
      approvedAt: new Date().toISOString(),
    };
    return { approvals };
  }
  return { error: "invalid action" };
}

/**
 * Title-case a URL-safe id ("hero-card" -> "Hero Card"). Shared so the dev
 * middleware and the prod launcher produce identical preview labels.
 *
 * @param {string} id
 * @returns {string}
 */
export function titlecaseId(id) {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}
