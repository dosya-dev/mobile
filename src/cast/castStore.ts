import { create } from "zustand";

export type CastStatus = "idle" | "connecting" | "connected";

/**
 * The Cast session as the app sees it.
 *
 * Global, not viewer state: the TV keeps playing after the viewer closes, and
 * opening another file has to know a session is already up so it can follow
 * along instead of asking for a device again.
 */
interface CastState {
  status: CastStatus;
  /** The TV's own name ("Living Room TV"), once a session is up. */
  deviceName: string | null;
  /** The file the TV was last handed, so the viewer knows what is on it. */
  fileId: string | null;
  setStatus: (status: CastStatus, deviceName?: string | null) => void;
  setFile: (fileId: string | null) => void;
}

export const useCastStore = create<CastState>((set) => ({
  status: "idle",
  deviceName: null,
  fileId: null,
  setStatus: (status, deviceName) =>
    set((s) => ({
      status,
      deviceName: status === "idle" ? null : deviceName ?? s.deviceName,
      fileId: status === "idle" ? null : s.fileId,
    })),
  setFile: (fileId) => set({ fileId }),
}));
