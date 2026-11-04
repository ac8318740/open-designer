// Host-side copy of the element selections. The picking itself runs in the
// frame's bridge script (bridge/frame.ts); this store only mirrors what the
// frame reports and what the composer removes.

import type { Selection } from "./bridge/protocol";

export { MAX_SELECTIONS } from "./bridge/protocol";

type SelectionListener = (selections: Selection[]) => void;

export class Picker {
  private enabled = false;
  private selections: Selection[] = [];
  private listeners = new Set<SelectionListener>();

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  getSelections(): Selection[] {
    return [...this.selections];
  }

  onChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    listener(this.getSelections());
    return () => this.listeners.delete(listener);
  }

  set(items: Selection[]): void {
    this.selections = [...items];
    this.broadcast();
  }

  // Mirrors the frame's renumbering so the composer updates even while the
  // picker is off, when the frame's echo is dropped.
  removeById(id: number): void {
    const index = this.selections.findIndex((s) => s.id === id);
    if (index === -1) return;
    this.selections = this.selections
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, id: i + 1 }));
    this.broadcast();
  }

  clearAll(): void {
    this.selections = [];
    this.broadcast();
  }

  private broadcast(): void {
    const snapshot = this.getSelections();
    for (const fn of this.listeners) fn(snapshot);
  }
}
