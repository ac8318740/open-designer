import type { SelectionSnapshot } from "./types";

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

export function buildPayload(args: {
  project: string;
  file: string;
  selections: SelectionSnapshot[];
  prompt: string;
  activeTweaks?: Record<string, string>;
}): string {
  const { project, file, selections, prompt, activeTweaks } = args;
  const trimmedPrompt = prompt.trim() || "(no request – placeholder, please ask me)";

  if (selections.length === 1) {
    const sel = selections[0];
    return [
      `I selected an element in draft \`${file}\` (project \`${project}\`).`,
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

  const header = `I selected ${selections.length} elements in draft \`${file}\` (project \`${project}\`).`;
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
