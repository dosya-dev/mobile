import TrackPlayer from "react-native-track-player";
import { PLACEHOLDER_URL, cycleRepeat, jumpTo, next, playFolder, previous, resolveWindow, stopAndClear, toggleShuffle } from "./controller";
import { usePlayerStore } from "./playerStore";
import { fetchAllAudioTracks } from "./queue";
import { resolveTrackUrl } from "./resolver";
import { cacheTrack, cancelCachingExcept, getCachedUri, markPlayed } from "./cache";
import { extractMetadataFromUrl } from "./metadata/extract";
import { PARSER_VERSION, useMetadataStore } from "./metadata/metadataStore";
import { toast } from "@/ui/toast";
import type { PlayerTrack } from "./types";

jest.mock("./queue", () => ({ ...jest.requireActual("./queue"), fetchAllAudioTracks: jest.fn() }));
jest.mock("./resolver", () => ({ resolveTrackUrl: jest.fn() }));
jest.mock("./cache", () => ({ cacheTrack: jest.fn(async () => {}), cancelCachingExcept: jest.fn(), getCachedUri: jest.fn(async () => null), markPlayed: jest.fn(async () => {}) }));
jest.mock("./metadata/extract", () => ({ extractMetadataFromUrl: jest.fn(async () => ({})) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

const t = (fileId: string): PlayerTrack => ({ fileId, title: fileId, artist: "Mix", extension: "mp3", sizeBytes: 1, modifiedAt: 1 });
const P = { workspaceId: "w1", folderId: "d1", filter: "all" as const, sort: "newest" as const, loadedPages: [], sourceName: "Mix" };

const flush = () => new Promise((resolve) => setImmediate(resolve));
const tagsKnown = (fileId: string) => useMetadataStore.setState({
  entries: { [fileId]: { fileId, sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION } },
});

beforeEach(() => {
  usePlayerStore.getState().clear();
  useMetadataStore.setState({ entries: {} });
  jest.clearAllMocks();
  (resolveTrackUrl as jest.Mock).mockImplementation(async (track: PlayerTrack) => ({ url: `https://r2/${track.fileId}`, fromCache: false }));
});

describe("playFolder", () => {
  it("builds the native queue with only the start track resolved, then plays from it", async () => {
    (fetchAllAudioTracks as jest.Mock).mockResolvedValue({ tracks: [t("a"), t("b"), t("c")], truncated: false });
    const ok = await playFolder({ ...P, startFileId: "b" });
    expect(ok).toBe(true);
    expect(TrackPlayer.reset).toHaveBeenCalled();
    const added = (TrackPlayer.add as jest.Mock).mock.calls[0][0];
    expect(added.map((x: any) => x.url)).toEqual([PLACEHOLDER_URL, "https://r2/b", PLACEHOLDER_URL]);
    expect(TrackPlayer.skip).toHaveBeenCalledWith(1);
    expect(TrackPlayer.play).toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(1);
    expect(usePlayerStore.getState().sourceName).toBe("Mix");
  });

  it("toasts and declines when the folder has no audio", async () => {
    (fetchAllAudioTracks as jest.Mock).mockResolvedValue({ tracks: [], truncated: false });
    expect(await playFolder(P)).toBe(false);
    expect(toast).toHaveBeenCalledWith("No audio files here.");
    expect(TrackPlayer.play).not.toHaveBeenCalled();
  });

  it("announces truncation at the 500-track cap", async () => {
    (fetchAllAudioTracks as jest.Mock).mockResolvedValue({ tracks: [t("a")], truncated: true });
    await playFolder(P);
    expect(toast).toHaveBeenCalledWith("Queue capped at 500 tracks.");
  });
});

describe("resolveWindow", () => {
  it("resolves the next placeholder, prefetches it, and reads the streaming track's tags over a range", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b"), t("c")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "https://r2/a" }, { id: "b", url: PLACEHOLDER_URL }, { id: "c", url: PLACEHOLDER_URL },
    ]);
    await resolveWindow(0);
    expect(markPlayed).toHaveBeenCalledWith("a");
    expect(extractMetadataFromUrl).toHaveBeenCalledWith(t("a"), "https://r2/a");
    expect(cacheTrack).not.toHaveBeenCalledWith(t("a"), expect.anything()); // the stream is the only full copy
    expect(TrackPlayer.remove).toHaveBeenCalledWith([1]);
    expect(TrackPlayer.add).toHaveBeenCalledWith({ id: "b", url: "https://r2/b", title: "b", artist: "Mix" }, 1);
    expect(cacheTrack).toHaveBeenCalledWith(t("b"), "https://r2/b");     // next-track prefetch
    const keep = (cancelCachingExcept as jest.Mock).mock.calls[0][0] as Set<string>;
    expect([...keep]).toEqual(["b"]);
  });

  it("falls back to a local copy when the tags cannot be read over a range", async () => {
    (extractMetadataFromUrl as jest.Mock).mockRejectedValueOnce(new Error("range read got 200"));
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([{ id: "a", url: "https://r2/a" }]);
    await resolveWindow(0);
    await flush();
    expect(cacheTrack).toHaveBeenCalledWith(t("a"), "https://r2/a");
  });

  it("does not read tags for a track that already has them", async () => {
    tagsKnown("a");
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([{ id: "a", url: "https://r2/a" }]);
    await resolveWindow(0);
    expect(extractMetadataFromUrl).not.toHaveBeenCalled();
  });

  it("does not read tags over the network for a track already on disk", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([{ id: "a", url: "file:///cache/audio-cache/a.mp3" }]);
    await resolveWindow(0);
    expect(extractMetadataFromUrl).not.toHaveBeenCalled();
  });

  // The heat bug: the phone streamed the song AND downloaded all of it again.
  it("does not download a copy of the streaming track once its tags are known", async () => {
    tagsKnown("a");
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "https://r2/a" }, { id: "b", url: PLACEHOLDER_URL },
    ]);
    await resolveWindow(0);
    expect(cacheTrack).not.toHaveBeenCalledWith(t("a"), expect.anything());
    expect(cacheTrack).toHaveBeenCalledWith(t("b"), "https://r2/b");
    const keep = (cancelCachingExcept as jest.Mock).mock.calls[0][0] as Set<string>;
    expect([...keep]).toEqual(["b"]);
  });

  describe("playing the prefetched copy", () => {
    const window = async () => {
      usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
      (TrackPlayer.getQueue as jest.Mock)
        .mockResolvedValueOnce([{ id: "a", url: "https://r2/a" }, { id: "b", url: PLACEHOLDER_URL }])
        .mockResolvedValue([{ id: "a", url: "https://r2/a" }, { id: "b", url: "https://r2/b" }]);
      (TrackPlayer.getActiveTrackIndex as jest.Mock).mockResolvedValue(0);
      (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 10, duration: 200, buffered: 20 });
    };
    const LOCAL = { id: "b", url: "file:///cache/b.mp3", title: "b", artist: "Mix" };

    it("swaps the next entry to the local file when the prefetch lands", async () => {
      await window();
      (getCachedUri as jest.Mock).mockResolvedValueOnce("file:///cache/b.mp3");
      await resolveWindow(0);
      await flush();
      expect(TrackPlayer.add).toHaveBeenLastCalledWith(LOCAL, 1);
    });

    it("leaves the stream link alone when the copy did not land", async () => {
      await window();
      await resolveWindow(0);
      await flush();
      expect(TrackPlayer.add).not.toHaveBeenCalledWith(LOCAL, 1);
    });

    it("does not touch the queue in the last seconds of a track", async () => {
      await window();
      (getCachedUri as jest.Mock).mockResolvedValueOnce("file:///cache/b.mp3");
      (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 195, duration: 200, buffered: 200 });
      await resolveWindow(0);
      await flush();
      expect(TrackPlayer.add).not.toHaveBeenCalledWith(LOCAL, 1);
    });

    it("does nothing when the listener has already moved on", async () => {
      await window();
      (getCachedUri as jest.Mock).mockResolvedValueOnce("file:///cache/b.mp3");
      (TrackPlayer.getActiveTrackIndex as jest.Mock).mockResolvedValue(1);
      await resolveWindow(0);
      await flush();
      expect(TrackPlayer.add).not.toHaveBeenCalledWith(LOCAL, 1);
    });
  });

  it("leaves an already-resolved next track alone", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "file:///cache/audio-cache/a.mp3" }, { id: "b", url: "https://r2/b" },
    ]);
    await resolveWindow(0);
    expect(TrackPlayer.remove).not.toHaveBeenCalled();
    // file:// active track is already cached - no cache-fill for it
    expect(cacheTrack).not.toHaveBeenCalledWith(t("a"), expect.anything());
  });

  it("repairs the active track itself when it's still a placeholder (e.g. a repeat-all wrap)", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: PLACEHOLDER_URL }, { id: "b", url: "https://r2/b" },
    ]);
    await resolveWindow(0);
    expect(TrackPlayer.load).toHaveBeenCalledWith({ id: "a", url: "https://r2/a", title: "a", artist: "Mix" });
    expect(TrackPlayer.play).toHaveBeenCalled();
  });
});

describe("navigation", () => {
  it("jumpTo resolves a placeholder target before skipping", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b"), t("c")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "https://r2/a" }, { id: "b", url: PLACEHOLDER_URL }, { id: "c", url: PLACEHOLDER_URL },
    ]);
    await jumpTo(2);
    expect(TrackPlayer.remove).toHaveBeenCalledWith([2]);
    expect(TrackPlayer.add).toHaveBeenCalledWith({ id: "c", url: "https://r2/c", title: "c", artist: "Mix" }, 2);
    expect(TrackPlayer.skip).toHaveBeenCalledWith(2);
    expect(TrackPlayer.play).toHaveBeenCalled();
  });

  it("auto-advance past the end is a no-op unless repeat-queue wraps to the start", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 1, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([{ id: "a", url: "https://r2/a" }, { id: "b", url: "https://r2/b" }]);
    await next();
    expect(TrackPlayer.skip).not.toHaveBeenCalled();
    usePlayerStore.getState().setRepeatMode("queue");
    await next();
    expect(TrackPlayer.skip).toHaveBeenCalledWith(0);
  });

  it("a pressed Next on the last track wraps to the first even with repeat off", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b"), t("c"), t("d")], 3, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "https://r2/a" }, { id: "b", url: "https://r2/b" },
      { id: "c", url: "https://r2/c" }, { id: "d", url: "https://r2/d" },
    ]);
    expect(usePlayerStore.getState().repeatMode).toBe("off");
    await next({ wrap: true });
    expect(TrackPlayer.skip).toHaveBeenCalledWith(0);
    expect(TrackPlayer.play).toHaveBeenCalled();
  });

  it("a pressed Next mid-queue still just steps forward", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b"), t("c")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "https://r2/a" }, { id: "b", url: "https://r2/b" }, { id: "c", url: "https://r2/c" },
    ]);
    await next({ wrap: true });
    expect(TrackPlayer.skip).toHaveBeenCalledWith(1);
  });

  it("wrapping an empty queue does nothing", async () => {
    usePlayerStore.getState().clear();
    await next({ wrap: true });
    expect(TrackPlayer.skip).not.toHaveBeenCalled();
  });

  it("previous restarts the track when more than 3s in, else steps back", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 1, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([{ id: "a", url: "https://r2/a" }, { id: "b", url: "https://r2/b" }]);
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 10, duration: 60, buffered: 0 });
    await previous();
    expect(TrackPlayer.seekTo).toHaveBeenCalledWith(0);
    expect(TrackPlayer.skip).not.toHaveBeenCalled();
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 1, duration: 60, buffered: 0 });
    await previous();
    expect(TrackPlayer.skip).toHaveBeenCalledWith(0);
  });
});

describe("shuffle and repeat", () => {
  it("shuffle keeps the current track, reorders upcoming, and restores on unshuffle", async () => {
    const queue = [t("a"), t("b"), t("c"), t("d")];
    usePlayerStore.getState().setQueue(queue, 1, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue(queue.map((x) => ({ id: x.fileId, url: PLACEHOLDER_URL })));
    (TrackPlayer.getActiveTrackIndex as jest.Mock).mockResolvedValue(1);
    await toggleShuffle();
    const s1 = usePlayerStore.getState();
    expect(s1.shuffled).toBe(true);
    expect(s1.queue[s1.index].fileId).toBe("b");
    expect(new Set(s1.queue.map((x) => x.fileId))).toEqual(new Set(["a", "b", "c", "d"]));
    await toggleShuffle();
    const s2 = usePlayerStore.getState();
    expect(s2.shuffled).toBe(false);
    expect(s2.queue.map((x) => x.fileId)).toEqual(["a", "b", "c", "d"]);
    expect(s2.index).toBe(1);
  });

  it("cycleRepeat walks off -> queue -> track -> off and mirrors natively", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    await cycleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe("queue");
    await cycleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe("track");
    await cycleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe("off");
    expect(TrackPlayer.setRepeatMode).toHaveBeenCalledTimes(3);
  });
});

describe("stopAndClear", () => {
  it("cancels cache fills, resets the native player, and empties the store", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    await stopAndClear();
    expect(cancelCachingExcept).toHaveBeenCalledWith(new Set());
    expect(TrackPlayer.reset).toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(-1);
  });
});

describe("queue mutation serialization", () => {
  it("keeps concurrent jumpTo and resolveWindow calls from interleaving native queue ops", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b"), t("c")], 0, "Mix");
    (TrackPlayer.getQueue as jest.Mock).mockResolvedValue([
      { id: "a", url: "https://r2/a" }, { id: "b", url: PLACEHOLDER_URL }, { id: "c", url: PLACEHOLDER_URL },
    ]);
    // Fired back-to-back with no await between - mirrors a service event racing
    // a user tap. Without the mutex these two read-modify-write sequences
    // interleave and corrupt the queue.
    const p1 = jumpTo(2);
    const p2 = resolveWindow(0);
    await Promise.all([p1, p2]);

    const removeMock = TrackPlayer.remove as jest.Mock;
    const addMock = TrackPlayer.add as jest.Mock;
    expect(removeMock).toHaveBeenCalledTimes(2);
    expect(addMock).toHaveBeenCalledTimes(2);
    // jumpTo(2) went first (called first) - its remove/add pair must be first.
    expect(removeMock.mock.calls[0][0]).toEqual([2]);
    expect(addMock.mock.calls[0][1]).toBe(2);
    // resolveWindow(0)'s next-track repair (index 1) comes second.
    expect(removeMock.mock.calls[1][0]).toEqual([1]);
    expect(addMock.mock.calls[1][1]).toBe(1);
    // Strictly non-interleaved: jumpTo(2)'s add completes before resolveWindow(0)'s
    // remove even begins (jest's invocationCallOrder is a shared counter across mocks).
    expect(addMock.mock.invocationCallOrder[0]).toBeLessThan(removeMock.mock.invocationCallOrder[1]);
  });
});

describe("ensureSetup", () => {
  const setupOn = async (os: string) => {
    let options: Record<string, unknown> = {};
    await jest.isolateModulesAsync(async () => {
      const rn = require("react-native");
      const was = rn.Platform.OS;
      Object.defineProperty(rn.Platform, "OS", { value: os, configurable: true });
      try {
        const rntp = require("react-native-track-player");
        await require("./controller").ensureSetup();
        options = (rntp.default ?? rntp).setupPlayer.mock.calls[0][0];
      } finally {
        Object.defineProperty(rn.Platform, "OS", { value: was, configurable: true });
      }
    });
    return options;
  };

  it("gives Android a gap between its buffer marks so the radio can rest", async () => {
    const options = await setupOn("android");
    expect(options.maxBuffer as number).toBeGreaterThan(options.minBuffer as number);
  });

  it("leaves iOS buffering to the system", async () => {
    const options = await setupOn("ios");
    expect(options.minBuffer).toBeUndefined();
    expect(options.maxBuffer).toBeUndefined();
  });

  it("asks for native progress events no more often than the position is worth saving", async () => {
    await jest.isolateModulesAsync(async () => {
      const rntp = require("react-native-track-player");
      const { ensureSetup } = require("./controller");
      await ensureSetup();
      const options = (rntp.default ?? rntp).updateOptions.mock.calls[0][0];
      expect(options.progressUpdateEventInterval).toBeGreaterThanOrEqual(30);
    });
  });
});
