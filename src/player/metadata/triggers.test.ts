import TrackPlayer from "react-native-track-player";
import { installMetadataTriggers, onPlaybackStarted, resetNowPlayingPush } from "./triggers";
import { PARSER_VERSION, useMetadataStore } from "./metadataStore";
import { usePlayerStore } from "../playerStore";
import { extractMetadata } from "./extract";
import { getCachedUri, setOnTrackCached } from "../cache";
import type { PlayerTrack } from "../types";

jest.mock("./extract", () => ({ extractMetadata: jest.fn(async () => ({ fileId: "a", title: "Tagged", artist: "Artist", artworkUri: "file:///art.jpg", sizeBytes: 1, modifiedAt: 1 })) }));
jest.mock("../cache", () => ({ getCachedUri: jest.fn(), setOnTrackCached: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => { throw new Error("ENOENT"); }),
  writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
}));

const t = (fileId: string): PlayerTrack => ({ fileId, title: fileId, artist: "Mix", extension: ".mp3", sizeBytes: 1, modifiedAt: 1 });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  usePlayerStore.getState().clear();
  useMetadataStore.getState()._resetForTests();
  jest.clearAllMocks();
  // pushedForFileId is module state in triggers.ts - reset it directly so each
  // test's push assertions are isolated from whichever test ran before it.
  resetNowPlayingPush();
});

describe("installMetadataTriggers", () => {
  it("registers the cache callback which extracts in the background", async () => {
    installMetadataTriggers();
    const cb = (setOnTrackCached as jest.Mock).mock.calls[0][0];
    cb(t("a"), "file:///cache/audio-cache/a.mp3");
    await flush();
    expect(extractMetadata).toHaveBeenCalledWith(t("a"), "file:///cache/audio-cache/a.mp3");
  });

  it("does not re-extract when the cached entry was parsed by the current extractor", async () => {
    installMetadataTriggers();
    useMetadataStore.getState().upsert({ fileId: "a", sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION });
    const cb = (setOnTrackCached as jest.Mock).mock.calls[0][0];
    cb(t("a"), "file:///cache/audio-cache/a.mp3");
    await flush();
    expect(extractMetadata).not.toHaveBeenCalled();
  });

  it("re-extracts an entry parsed by an OLDER extractor version", async () => {
    // The v1 extractor compared a dot-prefixed extension against a bare one,
    // matched no container, and stamped parsedAt anyway. Every track played
    // before the fix therefore looks "already processed" to a bare parsedAt
    // check and would stay tagless forever. The version bump is what retires
    // those entries.
    installMetadataTriggers();
    useMetadataStore.getState().upsert({ fileId: "a", sizeBytes: 1, modifiedAt: 1, parsedAt: 1 });
    const cb = (setOnTrackCached as jest.Mock).mock.calls[0][0];
    cb(t("a"), "file:///cache/audio-cache/a.mp3");
    await flush();
    expect(extractMetadata).toHaveBeenCalledWith(t("a"), "file:///cache/audio-cache/a.mp3");
  });

  it("re-extracts when the cached entry is bare (no parsedAt) - the streamed-then-cached bug", async () => {
    // ensureEntry() is called from onPlaybackStarted's duration-capture block
    // when a track STARTS PLAYING (streaming) before its background cache
    // download has finished - it records a bare {fileId, sizeBytes,
    // modifiedAt} entry with no parsedAt. Regression: the cache hook used to
    // gate on entry EXISTENCE alone, so once that download completed this
    // bare entry looked "already processed" and real extraction never ran -
    // tags/artwork/bitrate were lost permanently for that file version.
    installMetadataTriggers();
    useMetadataStore.getState().ensureEntry(t("a"));
    const cb = (setOnTrackCached as jest.Mock).mock.calls[0][0];
    cb(t("a"), "file:///cache/audio-cache/a.mp3");
    await flush();
    expect(extractMetadata).toHaveBeenCalledWith(t("a"), "file:///cache/audio-cache/a.mp3");
  });
});

describe("onPlaybackStarted", () => {
  it("captures the player duration once into the store", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 1, duration: 200, buffered: 0 });
    (getCachedUri as jest.Mock).mockResolvedValue(null);
    await onPlaybackStarted();
    expect(useMetadataStore.getState().entries["a"]?.durationSec).toBe(200);
  });

  it("extracts a cached active track without metadata and pushes Now Playing tags", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    (getCachedUri as jest.Mock).mockResolvedValue("file:///cache/audio-cache/a.mp3");
    await onPlaybackStarted();
    expect(extractMetadata).toHaveBeenCalled();
    expect(TrackPlayer.updateMetadataForTrack).toHaveBeenCalledWith(0, expect.objectContaining({ title: "Tagged", artist: "Artist", artwork: "file:///art.jpg" }));
  });

  it("does not re-extract when metadata already exists and was parsed", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    useMetadataStore.getState().upsert({ fileId: "a", title: "Have", sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION });
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    await onPlaybackStarted();
    expect(extractMetadata).not.toHaveBeenCalled();
  });

  it("does not re-extract an untagged entry that was already parsed (parsedAt set)", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    // A bare entry (no title/artist/artwork) but WITH parsedAt - the outcome
    // of a prior parse that genuinely found no tags. ensureEntry() (used by
    // the duration-capture block below) never sets parsedAt, so it cannot
    // produce this state - see the cache-hook "streamed-then-cached bug" test
    // in the installMetadataTriggers describe block above.
    useMetadataStore.getState().upsert({ fileId: "a", sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION });
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    await onPlaybackStarted();
    expect(extractMetadata).not.toHaveBeenCalled();
  });

  it("pushes Now Playing metadata even when extraction is skipped", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    useMetadataStore.getState().upsert({ fileId: "a", title: "Have", artist: "Someone", artworkUri: "file:///art2.jpg", sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION });
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    await onPlaybackStarted();
    expect(extractMetadata).not.toHaveBeenCalled();
    expect(TrackPlayer.updateMetadataForTrack).toHaveBeenCalledWith(0, expect.objectContaining({ title: "Have", artist: "Someone", artwork: "file:///art2.jpg" }));
  });

  it("does not re-push for the same activation", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    useMetadataStore.getState().upsert({ fileId: "a", title: "Have", artist: "Someone", artworkUri: "file:///art2.jpg", sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION });
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    await onPlaybackStarted();
    await onPlaybackStarted();
    expect(TrackPlayer.updateMetadataForTrack).toHaveBeenCalledTimes(1);
  });

  it("re-pushes after resetNowPlayingPush()", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    useMetadataStore.getState().upsert({ fileId: "a", title: "Have", artist: "Someone", artworkUri: "file:///art2.jpg", sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: PARSER_VERSION });
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    await onPlaybackStarted();
    resetNowPlayingPush();
    await onPlaybackStarted();
    expect(TrackPlayer.updateMetadataForTrack).toHaveBeenCalledTimes(2);
  });

  it("does not record a duration under the original fileId when the active track changes mid-await", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    // getCachedUri's resolution is the await window during which playback can
    // move on (e.g. the user skipped): mutate the active index from inside
    // the mocked async dependency so the mutation genuinely lands mid-await,
    // not just before it.
    (getCachedUri as jest.Mock).mockImplementation(async () => {
      usePlayerStore.getState().setIndex(1);
      return null;
    });
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 200, buffered: 0 });
    await onPlaybackStarted();
    expect(useMetadataStore.getState().entries["a"]?.durationSec).toBeUndefined();
  });
});
