// Token-sync: parse tokens.css, compute divergences between the iframe's
// emitted tweak values and the on-disk tokens file.
//
// Scope: the current surface only. No multi-surface aggregation. No deeper
// than one level of `var(--x)` indirection (chains like
// --a → var(--b) → var(--c) resolve --a to --b's value, not --c's).

import {
  emittedValueFor,
  parseNumericToken,
  resolvedTargets,
  resolvedTransform,
} from "./tweaks";
import type { SyncDivergence, SyncDivergenceRow, TokensMap, Tweak } from "./types";

// Match `--name: value;` inside a block whose selector list contains `:root`
// (possibly with attribute selectors, and possibly alongside `:host` and
// friends in a comma-separated list). The value runs up to the next `;` that
// isn't inside parentheses; we approximate with `[^;]+`, which is sufficient
// for the tokens.css shapes we emit (no inline `;`).
const ROOT_BLOCK_RE = /(?:^|[^\w-]):root\b[^{}]*\{([\s\S]*?)\}/g;
const DECL_RE = /(--[\w-]+)\s*:\s*([^;]+);/g;

function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function parseTokensCss(text: string): TokensMap {
  const map: TokensMap = new Map();
  // Strip comments first so a `/* :root ... */` note can't fake a block and
  // so comments inside a selector list don't confuse the `[^{}]*` scan.
  const stripped = stripCssComments(text);
  let block: RegExpExecArray | null;
  ROOT_BLOCK_RE.lastIndex = 0;
  while ((block = ROOT_BLOCK_RE.exec(stripped)) !== null) {
    const body = block[1];
    DECL_RE.lastIndex = 0;
    let decl: RegExpExecArray | null;
    while ((decl = DECL_RE.exec(body)) !== null) {
      const name = decl[1];
      const value = decl[2].trim();
      // Later declarations override earlier ones – :root blocks lower in the
      // file (e.g. @media overrides, theme shelves) win.
      map.set(name, value);
    }
  }
  // Resolve one level of var(--x) references. Deeper chains are left as-is
  // so we never loop on a cycle.
  const resolved: TokensMap = new Map();
  for (const [k, v] of map) {
    resolved.set(k, resolveOneLevel(v, map));
  }
  return resolved;
}

function resolveOneLevel(value: string, map: TokensMap): string {
  const m = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (!m) return value;
  const hit = map.get(m[1]);
  if (hit !== undefined) return hit.trim();
  if (m[2] !== undefined) return m[2].trim();
  return value;
}

export async function loadTokensMap(chain: string[]): Promise<TokensMap> {
  // chain is parent→child DS names. Later wins.
  const merged: TokensMap = new Map();
  for (const name of chain) {
    try {
      const r = await fetch(`/data/design-systems/${name}/tokens.css`);
      if (!r.ok) continue;
      const text = await r.text();
      const parsed = parseTokensCss(text);
      for (const [k, v] of parsed) merged.set(k, v);
    } catch {
      // Network or parse failures for one link shouldn't block the rest.
    }
  }
  // Re-resolve once more in case child overrides references that resolved
  // against the parent map.
  const out: TokensMap = new Map();
  for (const [k, v] of merged) out.set(k, resolveOneLevel(v, merged));
  return out;
}

function normalizeForCompare(value: string): string {
  const t = value.trim().toLowerCase();
  // Collapse internal whitespace for multi-token values like font stacks.
  return t.replace(/\s+/g, " ");
}

export function computeTokenDivergences(
  tweaks: Tweak[],
  values: Record<string, string>,
  tokensMap: TokensMap,
  touched?: ReadonlySet<string>,
): SyncDivergence[] {
  const out: SyncDivergence[] = [];
  for (const tweak of tweaks) {
    if (tweak.type === "state") continue;
    const targets = resolvedTargets(tweak);
    if (targets.length === 0) continue;
    const raw = values[tweak.id];
    if (raw === undefined) continue;
    // Tweaks without a declared default fall back to a placeholder (e.g.
    // "#000000" for color). If the user hasn't touched this tweak, the
    // fallback is meaningless and comparing it to tokens.css produces a
    // phantom divergence on fresh load. Skip those.
    if (tweak.default === undefined && touched && !touched.has(tweak.id)) {
      continue;
    }
    const transform = resolvedTransform(tweak);

    // Skip identity-valued add/scale up-front – any 0-add or 1-scale slider
    // produces no change and shouldn't show as divergence.
    if (transform === "add" && parseFloat(raw) === 0) continue;
    if (transform === "scale" && parseFloat(raw) === 1) continue;

    const rows: SyncDivergenceRow[] = [];
    for (const target of targets) {
      const tokensValue = tokensMap.get(target) ?? null;
      const emitted = emittedValueFor(tweak, raw, target, tokensMap);
      if (emitted === null) {
        // add/scale can't resolve without a base value → treat as diverged
        // against "undeclared".
        if (tokensValue === null) {
          rows.push({ target, currentValue: "(unresolved)", tokensValue: null });
        }
        continue;
      }
      const currentValue = emitted;
      if (tokensValue === null) {
        rows.push({ target, currentValue, tokensValue: null });
        continue;
      }
      if (normalizeForCompare(currentValue) === normalizeForCompare(tokensValue)) {
        continue;
      }
      // For set transforms on sliders, compare parsed numerics too so
      // "4px" and "4.000px" are treated as equal.
      if (transform === "set" && tweak.type === "slider") {
        const a = parseNumericToken(currentValue);
        const b = parseNumericToken(tokensValue);
        if (a !== null && b !== null && a === b) continue;
      }
      rows.push({ target, currentValue, tokensValue });
    }
    if (rows.length === 0) continue;
    out.push({
      tweakId: tweak.id,
      tweakLabel: tweak.label,
      transform,
      rows,
      ...(transform !== "set" ? { scalar: raw } : {}),
      ...(tweak.unit ? { unit: tweak.unit } : {}),
    });
  }
  return out;
}
