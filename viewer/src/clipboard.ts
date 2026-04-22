import type { SelectionSnapshot, ViewerMode } from "./types";

const OUTER_HTML_LIMIT = 2048;

function truncate(html: string): string {
  if (html.length <= OUTER_HTML_LIMIT) return html;
  return html.slice(0, OUTER_HTML_LIMIT) + "\n<!-- … truncated -->";
}

function formatStyles(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

function formatElement(sel: SelectionSnapshot): string {
  return [
    `${sel.id}. \`${sel.selector}\``,
    `   Bounding box: ${Math.round(sel.rect.width)}x${Math.round(sel.rect.height)} at (${Math.round(sel.rect.x)}, ${Math.round(sel.rect.y)})`,
    "",
    "   Outer HTML:",
    "   ```html",
    truncate(sel.outerHTML)
      .split("\n")
      .map((line) => "   " + line)
      .join("\n"),
    "   ```",
    "",
    "   Key computed styles:",
    formatStyles(sel.styles)
      .split("\n")
      .map((line) => "   " + line)
      .join("\n"),
  ].join("\n");
}

export interface PayloadContext {
  mode: ViewerMode;
  // In designs mode: the design name. In DS mode: the DS name.
  name: string;
  // In designs mode: the page id (optional). In DS mode: the playable page id.
  pageId?: string;
  variantId?: string;
  // In designs mode: the active DS that governs this design (optional).
  designSystem?: string;
}

function leadSentence(ctx: PayloadContext, count: number): string {
  const pageBit = ctx.pageId ? `page \`${ctx.pageId}\`` : "";
  const variantBit = ctx.variantId ? `variant \`${ctx.variantId}\`` : "";
  const parts = [pageBit, variantBit].filter(Boolean).join(", ");
  const locator = parts ? ` (${parts})` : "";

  if (ctx.mode === "design-systems") {
    const countBit = count === 1 ? "an element" : `${count} elements`;
    return `I selected ${countBit} in design system \`${ctx.name}\`${locator ? ` – playable ${locator.slice(1)}` : ""}.`;
  }

  const countBit = count === 1 ? "an element" : `${count} elements`;
  const dsBit = ctx.designSystem ? ` (design system \`${ctx.designSystem}\`)` : "";
  return `I selected ${countBit} in design \`${ctx.name}\`${locator}${dsBit}.`;
}

export function buildPayload(args: {
  ctx: PayloadContext;
  selections: SelectionSnapshot[];
  prompt: string;
  activeTweaks?: Record<string, string>;
}): string {
  const { ctx, selections, prompt, activeTweaks } = args;
  const trimmedPrompt = prompt.trim() || "(no request – placeholder, please ask me)";

  if (selections.length === 1) {
    const sel = selections[0];
    return [
      leadSentence(ctx, 1),
      "",
      `Element selector: \`${sel.selector}\``,
      `Bounding box: ${Math.round(sel.rect.width)}x${Math.round(sel.rect.height)} at (${Math.round(sel.rect.x)}, ${Math.round(sel.rect.y)})`,
      "",
      "Outer HTML:",
      "```html",
      truncate(sel.outerHTML),
      "```",
      "",
      "Key computed styles:",
      formatStyles(sel.styles),
      activeTweaks && Object.keys(activeTweaks).length
        ? `\nActive tweaks: ${Object.entries(activeTweaks).map(([k, v]) => `${k}=${v}`).join(", ")}`
        : "",
      "",
      "My request:",
      trimmedPrompt,
      "",
    ].join("\n");
  }

  const header = leadSentence(ctx, selections.length);
  const blocks = selections.map(formatElement).join("\n\n");
  const tweaksLine =
    activeTweaks && Object.keys(activeTweaks).length
      ? `\nActive tweaks: ${Object.entries(activeTweaks).map(([k, v]) => `${k}=${v}`).join(", ")}\n`
      : "";

  return [
    header,
    "",
    "Shared request:",
    trimmedPrompt,
    tweaksLine,
    "Elements:",
    "",
    blocks,
    "",
  ].join("\n");
}
