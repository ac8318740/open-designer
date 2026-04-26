// Shared launcher write logic for both the dev-time vite middleware
// (data-server.ts) and the zero-dep production launcher (serve.mjs).
//
// Kept as plain .mjs so serve.mjs can import without a build step;
// the vite middleware consumes it via allowJs.

import { join, normalize, sep } from "node:path";

const SCHEMA_VERSION = 2;

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
 * Normalize a chosen entry from POST body or on-disk into a known shape.
 * Accepts and preserves `state` (runtime conditions) as a sibling of
 * `tweaks` (designer decisions) – see types.ts for the rationale.
 *
 * @param {unknown} entry
 * @returns {{ variantId: string, tweaks: Record<string, unknown>, state?: Record<string, unknown> }}
 */
export function sanitizeEntry(entry) {
  const e = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
  const out = {
    variantId: String(e.variantId ?? ""),
    tweaks: e.tweaks && typeof e.tweaks === "object" ? /** @type {Record<string, unknown>} */ (e.tweaks) : {},
  };
  if (e.state && typeof e.state === "object" && !Array.isArray(e.state)) {
    out.state = /** @type {Record<string, unknown>} */ (e.state);
  }
  return out;
}

/**
 * Convert a persisted chosen block (possibly legacy single-variant shape) into
 * the new pages-keyed shape so the merge logic only deals with one form.
 *
 * @param {unknown} existing
 * @returns {null | { finalizedAt: string, shippedAt?: string, pages: Record<string, ReturnType<typeof sanitizeEntry>> }}
 */
export function normalizeChosen(existing) {
  if (!existing || typeof existing !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (existing);
  if (obj.pages && typeof obj.pages === "object") {
    const pages = /** @type {Record<string, ReturnType<typeof sanitizeEntry>>} */ ({});
    for (const [pageId, entry] of Object.entries(/** @type {Record<string, unknown>} */ (obj.pages))) {
      pages[pageId] = sanitizeEntry(entry);
    }
    return {
      finalizedAt: String(obj.finalizedAt ?? new Date().toISOString()),
      ...(obj.shippedAt ? { shippedAt: String(obj.shippedAt) } : {}),
      pages,
    };
  }
  return {
    finalizedAt: String(obj.finalizedAt ?? new Date().toISOString()),
    ...(obj.shippedAt ? { shippedAt: String(obj.shippedAt) } : {}),
    pages: {
      main: sanitizeEntry({
        variantId: obj.variantId,
        tweaks: obj.tweaks,
      }),
    },
  };
}

/**
 * Apply a finalize POST body against the existing chosen state.
 *
 * Accepted body shapes:
 *   { chosenPage: { pageId, entry: { variantId, tweaks, state? } } }
 *   { clearPage: pageId }
 *   { finalizeAll: { pages: { pageId: { variantId, tweaks, state? } } } }
 *   { clearAll: true }
 *   { markShipped: <iso-string> }   – stamp shippedAt on existing chosen
 *
 * Returns { chosen } on success (chosen is null to clear), or { error }.
 *
 * The legacy `{ chosen: {...} | null }` write-side shape is gone. The viewer
 * never sent it; design-integrate now uses `markShipped` to stamp shippedAt.
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
    const pages = /** @type {Record<string, ReturnType<typeof sanitizeEntry>>} */ ({});
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

  if (body.markShipped !== undefined) {
    if (!current) return { error: "markShipped requires an existing chosen block" };
    const stamp =
      typeof body.markShipped === "string" && body.markShipped.length > 0
        ? body.markShipped
        : now;
    return {
      chosen: {
        ...current,
        shippedAt: stamp,
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

// Map a wire-protocol surfaceKind to the on-disk approval key prefix.
// New clients send "tokens"; the legacy alias "preview" stays accepted so
// any older tooling still works.
function surfaceKeyPrefix(kind) {
  if (kind === "page") return "pages";
  if (kind === "tokens" || kind === "preview") return "tokens";
  return null;
}

/**
 * Apply an approvals POST body against the existing approvals state. Returns
 * the merged approvals object on success, or an error message.
 *
 * Accepted body shapes:
 *   { action: "set", surfaceKind: "page"|"tokens", surfaceId, variantId?, tweaks? }
 *   { action: "clear", surfaceKind: "page"|"tokens", surfaceId }
 *
 * (The legacy alias "preview" for surfaceKind is still accepted on read so
 * existing approvals.json files keep working.)
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
  const approvals = { schemaVersion: SCHEMA_VERSION, surfaces };
  const action = body?.action;
  const kind = body?.surfaceKind;
  const id = body?.surfaceId;
  if (!id || typeof id !== "string") return { error: "missing surfaceId" };
  const prefix = surfaceKeyPrefix(kind);
  if (!prefix) return { error: "invalid surfaceKind" };
  const key = `${prefix}/${id}`;
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

// --- Schema validation ----------------------------------------------------

/**
 * Walk a parsed DesignIndex looking for missing finalize-discard fields.
 * Returns a list of warning strings; the caller decides whether to surface
 * them to the user. This is **warn-only this release** – the next release
 * will upgrade these warnings into hard errors.
 *
 * @param {unknown} index
 * @param {string} designName
 * @returns {string[]}
 */
export function validateDesignIndex(index, designName) {
  const warnings = [];
  if (!index || typeof index !== "object") return warnings;
  const obj = /** @type {Record<string, unknown>} */ (index);
  const pages = Array.isArray(obj.pages) ? obj.pages : [];
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const p = /** @type {Record<string, unknown>} */ (page);
    const pageId = String(p.id ?? "");
    // Variants past the first must declare discardReason.
    const variants = Array.isArray(p.variants) ? p.variants : [];
    for (let i = 1; i < variants.length; i++) {
      const v = variants[i];
      if (!v || typeof v !== "object") continue;
      const variant = /** @type {Record<string, unknown>} */ (v);
      const reason = variant.discardReason;
      if (typeof reason !== "string" || reason.trim().length === 0) {
        warnings.push(
          `[${designName}] page "${pageId}" variant "${variant.id ?? `#${i}`}" is missing discardReason – the finalize-discard test should record why this variant drops from production when un-picked.`,
        );
      }
    }
    // select / toggle tweaks at every level (design / page / variant) need it.
    const visit = (tweaks, scope) => {
      if (!Array.isArray(tweaks)) return;
      for (const t of tweaks) {
        if (!t || typeof t !== "object") continue;
        const tweak = /** @type {Record<string, unknown>} */ (t);
        if (tweak.type !== "select" && tweak.type !== "toggle") continue;
        const reason = tweak.discardReason;
        if (typeof reason !== "string" || reason.trim().length === 0) {
          warnings.push(
            `[${designName}] ${scope} ${tweak.type} tweak "${tweak.id ?? "(unnamed)"}" is missing discardReason – the finalize-discard test should record why the un-picked options drop from production.`,
          );
        }
      }
    };
    visit(p.tweaks, `page "${pageId}"`);
    for (const v of variants) {
      if (!v || typeof v !== "object") continue;
      const variant = /** @type {Record<string, unknown>} */ (v);
      visit(variant.tweaks, `page "${pageId}" variant "${variant.id ?? "?"}"`);
    }
  }
  visitDesignTweaks(obj.tweaks, designName, warnings);
  return warnings;
}

function visitDesignTweaks(tweaks, designName, warnings) {
  if (!Array.isArray(tweaks)) return;
  for (const t of tweaks) {
    if (!t || typeof t !== "object") continue;
    const tweak = /** @type {Record<string, unknown>} */ (t);
    if (tweak.type !== "select" && tweak.type !== "toggle") continue;
    const reason = tweak.discardReason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      warnings.push(
        `[${designName}] design-level ${tweak.type} tweak "${tweak.id ?? "(unnamed)"}" is missing discardReason.`,
      );
    }
  }
}

export const FINALIZE_SCHEMA_VERSION = SCHEMA_VERSION;
