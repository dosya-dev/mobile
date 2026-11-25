import { create } from "zustand";
import type { UploadItem } from "./types";

interface UploadState {
  items: UploadItem[];
  batchStartedAt: number | null; // epoch ms the current upload batch began (speed/ETA clock)
  // Aggregate of DONE backup items folded out of `items` mid-run: a 5k-photo
  // run keeps ~backpressure-ceiling live objects instead of 5k. Speed/ETA math
  // adds these baselines back (computeUploadStats `settled` param).
  settledBk: { count: number; bytes: number };
  enqueue: (items: UploadItem[]) => void;
  /** Fold finished backup uploads into the settled counters (RAM stays flat). */
  foldSettledBk: () => void;
  /** New run: baselines restart from zero. */
  resetSettledBk: () => void;
  patch: (id: string, partial: Partial<UploadItem>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  clear: () => void;
  setBatchStartedAt: (t: number | null) => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  items: [],
  batchStartedAt: null,
  settledBk: { count: 0, bytes: 0 },
  enqueue: (items) => set((s) => ({ items: [...s.items, ...items] })),
  foldSettledBk: () =>
    set((s) => {
      const done = s.items.filter((i) => i.id.startsWith("bk_") && i.status === "done");
      if (done.length === 0) return s;
      return {
        items: s.items.filter((i) => !(i.id.startsWith("bk_") && i.status === "done")),
        settledBk: {
          count: s.settledBk.count + done.length,
          bytes: s.settledBk.bytes + done.reduce((n, i) => n + (i.size > 0 ? i.size : 0), 0),
        },
      };
    }),
  resetSettledBk: () => set({ settledBk: { count: 0, bytes: 0 } }),
  patch: (id, partial) =>
    set((s) => {
      // Identity-preserving: untouched items keep their refs (memoized rows
      // skip re-render) and a missing id is a no-op (no state churn).
      const idx = s.items.findIndex((i) => i.id === id);
      if (idx === -1) return s;
      const items = s.items.slice();
      items[idx] = { ...items[idx], ...partial };
      return { items };
    }),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status !== "done") })),
  clear: () => set({ items: [], batchStartedAt: null, settledBk: { count: 0, bytes: 0 } }),
  setBatchStartedAt: (t) => set({ batchStartedAt: t }),
}));
