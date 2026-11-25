import { create } from "zustand";

/**
 * Whether the Files left menu is open. Mounted in the tabs layout, opened from
 * the Files root header or the edge swipe. `dragging` is true while the edge
 * swipe's finger drives the menu: it is on screen but not yet `open`.
 */
export const useFilesMenu = create<{
  open: boolean;
  dragging: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  setDragging: (dragging: boolean) => void;
}>((set) => ({
  open: false,
  dragging: false,
  openMenu: () => set({ open: true }),
  closeMenu: () => set({ open: false }),
  setDragging: (dragging) => set({ dragging }),
}));
