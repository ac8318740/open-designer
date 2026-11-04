// Ambient types for react-build.mjs, which the Vite dev server shares with serve.mjs.

export const REACT_PAGE: RegExp;

export function buildReactPage(dataRoot: string, rel: string): Promise<string>;

export function typecheckChosen(
  dataRoot: string,
  design: string,
  index: { pages?: Array<{ id: string; variants?: Array<{ id: string; file: string }> }> },
  chosen: { pages?: Record<string, { variantId: string }> } | null,
): Promise<string | null>;
