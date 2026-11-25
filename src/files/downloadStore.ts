import { create } from "zustand";
import type { DownloadEntry, DownloadPhase } from "./downloadModel";

/**
 * In-flight downloads, keyed by file id.
 *
 * Keyed by FILE rather than by screen, because that is the whole point: the
 * viewer's ring, the file's row in the list and the transfer dock are three
 * views of one transfer, and navigating away from the viewer must not lose the
 * work. The screen this replaces held a `saving` boolean inside the viewer
 * component, so backing out of the viewer erased every trace of a running
 * download.
 *
 * Modelled on `upload/store.ts`, including its identity-preserving writes: a
 * progress tick for one file must not hand every other row a new object and
 * re-render the list.
 */
interface DownloadState {
  entries: Record<string, DownloadEntry>;
  /**
   * Open an entry before the URL is even resolved, so the ring reacts on press.
   * `workspace` is optional because not every caller knows it - a listing row
   * carries no workspace - and a transfer with no label is better than one
   * with a wrong one.
   */
  start: (fileId: string, name: string, now: number, workspace?: { id: string; name?: string }) => void;
  progress: (fileId: string, written: number, total: number) => void;
  setPhase: (fileId: string, phase: DownloadPhase) => void;
  fail: (fileId: string, message: string) => void;
  clear: (fileId: string) => void;
  clearAll: () => void;
  /** Transfers still moving - what the dock counts and the 1s tick runs for. */
  activeIds: () => string[];
}

const MOVING: DownloadPhase[] = ["preparing", "downloading", "saving"];

export const useDownloadStore = create<DownloadState>((set, get) => ({
  entries: {},

  start: (fileId, name, now, workspace) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [fileId]: {
          fileId,
          name,
          phase: "preparing",
          written: 0,
          total: 0,
          startedAt: now,
          workspaceId: workspace?.id,
          workspaceName: workspace?.name,
        },
      },
    })),

  progress: (fileId, written, total) =>
    set((s) => {
      const prev = s.entries[fileId];
      // A tick for a file nobody started is a stale callback from a cancelled
      // download. Resurrecting a row from one would put a transfer back on
      // screen that the user has already dismissed.
      if (!prev) return s;
      return {
        entries: { ...s.entries, [fileId]: { ...prev, phase: "downloading", written, total } },
      };
    }),

  setPhase: (fileId, phase) =>
    set((s) => {
      const prev = s.entries[fileId];
      if (!prev) return s;
      return { entries: { ...s.entries, [fileId]: { ...prev, phase } } };
    }),

  fail: (fileId, message) =>
    set((s) => {
      const prev = s.entries[fileId];
      if (!prev) return s;
      // `written` is deliberately kept: a resumable download picks up from
      // there, and the byte count is what makes "tap to resume" believable.
      return { entries: { ...s.entries, [fileId]: { ...prev, phase: "error", message } } };
    }),

  clear: (fileId) =>
    set((s) => {
      if (!s.entries[fileId]) return s;
      const entries = { ...s.entries };
      delete entries[fileId];
      return { entries };
    }),

  clearAll: () => set({ entries: {} }),

  activeIds: () =>
    Object.values(get().entries)
      .filter((e) => MOVING.includes(e.phase))
      .map((e) => e.fileId),
}));
