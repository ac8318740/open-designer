import type { SelectionSnapshot } from "./types";

export interface ComposerDeps {
  root: HTMLElement;
  chipsRoot: HTMLElement;
  input: HTMLTextAreaElement;
  copyBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  getSelections: () => SelectionSnapshot[];
  onRemove: (id: number) => void;
  onClear: () => void;
  onCopy: (prompt: string) => void;
}

export function mountComposer(deps: ComposerDeps): (selections: SelectionSnapshot[]) => void {
  const { root, chipsRoot, input, copyBtn, clearBtn, onRemove, onClear, onCopy } = deps;

  copyBtn.addEventListener("click", () => onCopy(input.value));
  clearBtn.addEventListener("click", () => {
    input.value = "";
    onClear();
  });
  // Enter submits. Shift+Enter inserts a newline (default). isComposing guards
  // against IME composition (Japanese/Chinese input) where Enter commits the
  // candidate rather than submitting.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      onCopy(input.value);
    }
  });

  const countEl = document.getElementById("composer-count");

  return function render(selections: SelectionSnapshot[]) {
    if (selections.length === 0) {
      root.hidden = true;
      chipsRoot.innerHTML = "";
      if (countEl) countEl.textContent = "";
      return;
    }
    root.hidden = false;
    chipsRoot.innerHTML = "";
    for (const sel of selections) chipsRoot.appendChild(chip(sel, onRemove));
    if (countEl) countEl.textContent = `(${selections.length})`;
  };
}

function chip(sel: SelectionSnapshot, onRemove: (id: number) => void): HTMLElement {
  const el = document.createElement("span");
  el.className = "chip";
  el.setAttribute("role", "listitem");

  const num = document.createElement("span");
  num.className = "chip-num";
  num.textContent = String(sel.id);

  const label = document.createElement("span");
  label.className = "chip-label";
  label.textContent = shorten(sel.selector);
  label.title = sel.selector;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "chip-close";
  close.setAttribute("aria-label", `Remove element ${sel.id}`);
  close.textContent = "×";
  close.addEventListener("click", () => onRemove(sel.id));

  el.append(num, label, close);
  return el;
}

function shorten(s: string): string {
  if (s.length <= 32) return s;
  return s.slice(0, 14) + "…" + s.slice(-15);
}
