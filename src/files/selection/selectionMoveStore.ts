import { create } from "zustand";

/**
 * The destination picker's answer to "did the selection move?". A browser's
 * Move to... hands the picker a token naming its selection; the picker
 * records that token here once the move succeeds, and the browser whose token
 * it is leaves selection mode. A cancelled picker records nothing, so the
 * ticks are still there on the way back. Only that browser reacts: a folder
 * screen and the root under it each hold their own token.
 */
export const useSelectionMoves = create<{ moved: string | null; markMoved: (token: string) => void }>((set) => ({
  moved: null,
  markMoved: (token) => set({ moved: token }),
}));

let seq = 0;
/** A token unique to one Move to... press. */
export function nextMoveToken(): string {
  seq += 1;
  return `move-${Date.now().toString(36)}-${seq}`;
}
