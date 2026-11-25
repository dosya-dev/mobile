import { create } from "zustand";
import type { SharedFile } from "./types";

interface ShareIntentState {
  /** Files waiting for a destination. Null means nothing is in flight. */
  pending: SharedFile[] | null;
  /** Called by the native listener when Android hands the app a file. */
  receive: (files: SharedFile[]) => void;
  /** Returns the parked files and empties the slot. Null if there are none. */
  take: () => SharedFile[] | null;
  /** Sign-out. */
  clear: () => void;
}

/**
 * A one-slot holding area between the native intent listener and the destination
 * picker.
 *
 * It exists because the two are not reliably both alive at the same moment. A
 * share can land during a cold start, before the navigator has mounted, and it
 * can land while the user is signed out - AuthGate then redirects to
 * /(auth)/login and any navigation the listener attempted is discarded, losing
 * the file with no error shown. Parking the payload lets whoever is ready first
 * hand it to whoever is ready second. Same hazard the OAuth callback guard in
 * app/_layout.tsx was written for.
 */
export const useShareIntentStore = create<ShareIntentState>((set, get) => ({
  pending: null,
  receive: (files) => {
    // An empty delivery is a share with no stream attached - plain text from the
    // share sheet, most often. There is nothing to upload, and parking it would
    // open a destination picker for a file that does not exist.
    if (files.length === 0) return;
    // Replace rather than append. A second share arriving before the picker
    // opens means the user changed their mind; concatenating would silently
    // upload the file they walked away from.
    set({ pending: files });
  },
  take: () => {
    const { pending } = get();
    if (pending === null) return null;
    // Cleared on the way out, so this answers exactly once. Both callers can
    // fire repeatedly - the picker screen re-renders, and the root layout's
    // effect re-runs on every auth transition - and a second non-null answer
    // would mean a duplicate upload of the same file.
    set({ pending: null });
    return pending;
  },
  clear: () => set({ pending: null }),
}));
