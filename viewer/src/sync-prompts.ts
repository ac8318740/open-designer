// Pure prompt builders for the sync panel. These produce copy-paste Markdown
// the user feeds into Claude in a separate terminal – there is no direct
// tokens.css write endpoint.

import type { SyncDivergence } from "./types";

export interface SyncPromptContext {
  dsName: string;
  surfaceLabel: string;       // e.g. "Tokens · Radius"
  surfacePath: string;        // e.g. "preview/radius.html"
}

// Escape backticks so user-provided labels (DS name, surface/tweak labels)
// can't break out of the inline code spans in the generated Markdown. The
// content is for copy-paste into Claude, not HTML rendering, so normal
// Markdown escape rules apply.
function inlineCode(value: string): string {
  return value.replace(/`/g, "\\`");
}

function transformSuffix(div: SyncDivergence): string {
  if (div.transform === "add") {
    const sign = div.scalar && parseFloat(div.scalar) >= 0 ? "+" : "";
    return `transform: add, delta: ${sign}${div.scalar ?? ""}${div.unit ?? ""}`;
  }
  if (div.transform === "scale") {
    return `transform: scale, multiplier: ${div.scalar ?? ""}`;
  }
  return "transform: set";
}

function formatRows(
  div: SyncDivergence,
  valueLabel: "current emits" | "desired",
): string[] {
  return div.rows.map((row) => {
    const tokens = row.tokensValue ?? "(undeclared)";
    return `  - ${row.target}: tokens.css has ${tokens}, ${valueLabel} ${row.currentValue}`;
  });
}

export function buildPromotePrompt(
  ctx: SyncPromptContext,
  divergences: SyncDivergence[],
): string {
  const header =
    `In design system \`${inlineCode(ctx.dsName)}\`, I want to adopt the current tweak values on ` +
    `\`${inlineCode(ctx.surfaceLabel)}\` as the new DS defaults.`;
  const body = divergences
    .map((div) => {
      const heading = `- \`${inlineCode(div.tweakLabel)}\` (${transformSuffix(div)})`;
      return [heading, ...formatRows(div, "desired")].join("\n");
    })
    .join("\n\n");
  const footer = [
    "Please:",
    `1. Update \`.open-designer/design-systems/${inlineCode(ctx.dsName)}/tokens.css\` so these targets get the new values.`,
    "2. Review briefing docs (theme.md, gaps.md) for references to the old values and update them.",
    "3. Check whether derived tokens need follow-up changes (e.g. hover / contrast variants computed off the old value). Flag anything ambiguous.",
  ].join("\n");
  return [header, "", "Currently-diverging tweaks:", "", body, "", footer, ""].join("\n");
}
