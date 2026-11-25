import { create } from "zustand";

/**
 * Set by the Files root's browser while it is selecting or a drag-move is
 * held: the menu's edge swipe stands down so it cannot steal that gesture.
 */
export const useFilesInteraction = create<{ busy: boolean; setBusy: (busy: boolean) => void }>((set) => ({
  busy: false,
  setBusy: (busy) => set({ busy }),
}));
