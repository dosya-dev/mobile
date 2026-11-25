import { usePlayerStore } from "./playerStore";
import type { PlayerTrack } from "./types";

const t = (fileId: string): PlayerTrack => ({ fileId, title: fileId, artist: "Mix", extension: "mp3", sizeBytes: 1, modifiedAt: 1 });

beforeEach(() => usePlayerStore.getState().clear());

describe("playerStore", () => {
  it("starts idle", () => {
    const s = usePlayerStore.getState();
    expect(s.index).toBe(-1);
    expect(s.queue).toEqual([]);
    expect(s.playing).toBe(false);
  });

  it("setQueue seeds queue, index and source, and resets shuffle state", () => {
    usePlayerStore.getState().setShuffled(true, [t("x")]);
    usePlayerStore.getState().setQueue([t("a"), t("b")], 1, "Road trip");
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.fileId)).toEqual(["a", "b"]);
    expect(s.index).toBe(1);
    expect(s.sourceName).toBe("Road trip");
    expect(s.shuffled).toBe(false);
    expect(s.originalQueue).toBeNull();
  });

  it("clear returns everything to idle, including repeat mode", () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    usePlayerStore.getState().setPlaying(true);
    usePlayerStore.getState().setRepeatMode("queue");
    usePlayerStore.getState().clear();
    const s = usePlayerStore.getState();
    expect(s).toMatchObject({ queue: [], index: -1, playing: false, shuffled: false, repeatMode: "off", sourceName: null, originalQueue: null });
  });

  it("setQueueOrder reorders without touching the source label", () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    usePlayerStore.getState().setQueueOrder([t("b"), t("a")], 1);
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.fileId)).toEqual(["b", "a"]);
    expect(s.index).toBe(1);
    expect(s.sourceName).toBe("Mix");
  });
});
