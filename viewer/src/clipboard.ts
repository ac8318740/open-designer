// Builds the Markdown payload that the user pastes back into Claude Code.
// Format must stay aligned with skills/open-designer/SKILL.md – the skill
// pattern-matches on "I selected an element in draft `...`".

export interface SelectionContext {
  project: string;
  file: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  outerHTML: string;
  styles: Record<string, string>;
  prompt: string;
}

const OUTER_HTML_LIMIT = 2048;

export function truncateOuterHtml(html: string): string {
  if (html.length <= OUTER_HTML_LIMIT) return html;
  return html.slice(0, OUTER_HTML_LIMIT) + "\n<!-- … truncated -->";
}

export function buildPayload(ctx: SelectionContext): string {
  const { project, file, selector, rect, outerHTML, styles, prompt } = ctx;
  const stylesBlock = Object.entries(styles)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return [
    `I selected an element in draft \`${file}\` (project \`${project}\`).`,
    "",
    `Element selector: \`${selector}\``,
    `Bounding box: ${Math.round(rect.width)}x${Math.round(rect.height)} at (${Math.round(rect.x)}, ${Math.round(rect.y)})`,
    "",
    "Outer HTML:",
    "```html",
    truncateOuterHtml(outerHTML),
    "```",
    "",
    "Key computed styles:",
    stylesBlock,
    "",
    "My request:",
    prompt.trim() || "(no request – placeholder, please ask me)",
    "",
  ].join("\n");
}
