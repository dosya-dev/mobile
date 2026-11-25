import { create } from "zustand";
import type { PlayerTrack } from "./types";

export type RepeatModeSetting = "off" | "queue" | "track";

interface PlayerState {
  queue: PlayerTrack[];
  originalQueue: PlayerTrack[] | null;
  index: number;
  playing: boolean;
  /**
   * Audio is meant to be coming out. Unlike `playing` (the button's state) this
   * holds across the Loading and Ready blips between tracks, so work waiting
   * for the music to end does not start in the gap.
   */
  listening: boolean;
  shuffled: boolean;
  repeatMode: RepeatModeSetting;
  sourceName: string | null;
  setQueue: (queue: PlayerTrack[], index: number, sourceName: string) => void;
  setQueueOrder: (queue: PlayerTrack[], index: number) => void;
  setIndex: (index: number) => void;
  setPlaying: (playing: boolean) => void;
  setListening: (listening: boolean) => void;
  setShuffled: (shuffled: boolean, originalQueue: PlayerTrack[] | null) => void;
  setRepeatMode: (m: RepeatModeSetting) => void;
  clear: () => void;
}

/**
 * UI mirror of RNTP state. Deliberately NOT persisted: after an app restart the
 * native player is empty, so restoring a stale queue would draw a mini-player
 * with nothing behind it.
 */
export const usePlayerStore = create<PlayerState>((set) => ({
  queue: [],
  originalQueue: null,
  index: -1,
  playing: false,
  listening: false,
  shuffled: false,
  repeatMode: "off",
  sourceName: null,
  setQueue: (queue, index, sourceName) => set({ queue, index, sourceName, originalQueue: null, shuffled: false }),
  setQueueOrder: (queue, index) => set({ queue, index }),
  setIndex: (index) => set({ index }),
  setPlaying: (playing) => set({ playing }),
  setListening: (listening) => set({ listening }),
  setShuffled: (shuffled, originalQueue) => set({ shuffled, originalQueue }),
  setRepeatMode: (repeatMode) => set({ repeatMode }),
  clear: () => set({ queue: [], originalQueue: null, index: -1, playing: false, listening: false, shuffled: false, repeatMode: "off", sourceName: null }),
}));
