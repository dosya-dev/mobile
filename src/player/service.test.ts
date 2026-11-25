import TrackPlayer, { State } from "react-native-track-player";
import { playbackService } from "./service";
import { usePlayerStore } from "./playerStore";
import { next, resolveWindow } from "./controller";
import { resolveTrackUrl } from "./resolver";
import { toast } from "@/ui/toast";
import type { PlayerTrack } from "./types";
import * as i18n from "@/lib/i18n";

jest.mock("./controller", () => ({
  ...jest.requireActual("./controller"),
  next: jest.fn(async () => {}),
  previous: jest.fn(async () => {}),
  resolveWindow: jest.fn(async () => {}),
}));
jest.mock("./resolver", () => ({ resolveTrackUrl: jest.fn() }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("./metadata/triggers", () => ({
  installMetadataTriggers: jest.fn(),
  onPlaybackStarted: jest.fn(async () => {}),
  resetNowPlayingPush: jest.fn(),
}));
// The manual mock at __mocks__/react-native-track-player.js is auto-applied for
// plain imports (node_modules-adjacent __mocks__), but jest.requireMock() below
// only resolves to that SAME instance once the module has been explicitly
// jest.mock()-ed - otherwise it builds a second, disconnected copy (its own
// empty `listeners`), so __emit never reaches what the service registered.
jest.mock("react-native-track-player");

const { __emit, __reset } = jest.requireMock("react-native-track-player");
const t = (fileId: string): PlayerTrack => ({ fileId, title: fileId, artist: "Mix", extension: "mp3", sizeBytes: 1, modifiedAt: 1 });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  __reset();
  usePlayerStore.getState().clear();
  jest.clearAllMocks();
  await playbackService();
});

describe("playbackService", () => {
  it("mirrors playback state into the store", async () => {
    __emit("playback-state", { state: State.Playing });
    await flush();
    expect(usePlayerStore.getState().playing).toBe(true);
    __emit("playback-state", { state: State.Paused });
    await flush();
    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it("on track change: updates the index, clears retry bookkeeping, slides the window", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    __emit("playback-active-track-changed", { index: 1 });
    await flush();
    expect(usePlayerStore.getState().index).toBe(1);
    expect(resolveWindow).toHaveBeenCalledWith(1);
  });

  it("listening holds across the blips between tracks and ends on a real stop", async () => {
    __emit("playback-state", { state: State.Playing });
    expect(usePlayerStore.getState().listening).toBe(true);
    __emit("playback-state", { state: State.Loading });
    __emit("playback-state", { state: State.Ready });
    expect(usePlayerStore.getState().listening).toBe(true);
    expect(usePlayerStore.getState().playing).toBe(false);
    __emit("playback-state", { state: State.Paused });
    expect(usePlayerStore.getState().listening).toBe(false);
  });

  it("auto-advance (track change while already playing, no PlaybackState event) still fires onPlaybackStarted", async () => {
    // Android/ExoPlayer sliding into a preloaded next item stays in
    // STATE_READY/Playing - no Event.PlaybackState transition fires, only
    // PlaybackActiveTrackChanged. Without this, prefetched tracks (which
    // already have metadata) never get their lock-screen tags pushed and
    // parser-less durations never get captured during continuous listening.
    const { onPlaybackStarted } = jest.requireMock("./metadata/triggers");
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    usePlayerStore.getState().setPlaying(true);
    __emit("playback-active-track-changed", { index: 1 });
    await flush();
    expect(onPlaybackStarted).toHaveBeenCalled();
  });

  it("track change while NOT playing does not fire onPlaybackStarted", async () => {
    const { onPlaybackStarted } = jest.requireMock("./metadata/triggers");
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    usePlayerStore.getState().setPlaying(false);
    __emit("playback-active-track-changed", { index: 1 });
    await flush();
    expect(onPlaybackStarted).not.toHaveBeenCalled();
  });

  it("remote next/previous delegate to the controller, and remote next wraps", async () => {
    __emit("remote-next", {});
    await flush();
    // A lock-screen press is a deliberate Next, same as the in-app button: the
    // last track has to come back round rather than do nothing.
    expect(next).toHaveBeenCalledWith({ wrap: true });
  });

  it("remote seek seeks", async () => {
    __emit("remote-seek", { position: 42 });
    await flush();
    expect(TrackPlayer.seekTo).toHaveBeenCalledWith(42);
  });

  it("playback error: one re-resolve retry, resuming position", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 100, duration: 200, buffered: 0 });
    (resolveTrackUrl as jest.Mock).mockResolvedValue({ url: "https://r2/a-fresh", fromCache: false });
    __emit("playback-error", { code: "playback-source", message: "403" });
    await flush();
    expect(TrackPlayer.load).toHaveBeenCalledWith({ id: "a", url: "https://r2/a-fresh", title: "a", artist: "Mix" });
    expect(TrackPlayer.seekTo).toHaveBeenCalledWith(100);
    expect(TrackPlayer.play).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("playback error twice on the same track: skips onward with a toast", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    (resolveTrackUrl as jest.Mock).mockResolvedValue({ url: "https://r2/a-fresh", fromCache: false });
    __emit("playback-error", { code: "x", message: "boom" });
    await flush();
    __emit("playback-error", { code: "x", message: "boom" });
    await flush();
    expect(toast).toHaveBeenCalledWith('Couldn\'t play "a" - skipping.', "error");
    expect(next).toHaveBeenCalledTimes(1);
    // NOT wrapping: an unplayable last track would otherwise skip back to the
    // start and go round the queue forever instead of stopping.
    expect(next).toHaveBeenCalledWith();
  });

  it("playback error with a failing re-resolve (offline) skips instead of hanging", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    (resolveTrackUrl as jest.Mock).mockRejectedValue(new Error("Network request failed"));
    __emit("playback-error", { code: "x", message: "net" });
    await flush();
    expect(toast).toHaveBeenCalledWith('Couldn\'t play "a" - skipping.', "error");
    expect(next).toHaveBeenCalled();
  });

  it("same-track re-emission (the retry's own load() echo) does not re-enable retry", async () => {
    usePlayerStore.getState().setQueue([t("a")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    (resolveTrackUrl as jest.Mock).mockResolvedValue({ url: "https://r2/a-fresh", fromCache: false });
    __emit("playback-active-track-changed", { index: 0 });
    await flush();
    __emit("playback-error", { code: "x", message: "boom" }); // consumes the one retry
    await flush();
    // RNTP echoes an active-track-changed for the SAME track once the retry's own
    // load() lands - this must not refill the retry bookkeeping.
    __emit("playback-active-track-changed", { index: 0 });
    await flush();
    __emit("playback-error", { code: "x", message: "boom" });
    await flush();
    expect(TrackPlayer.load).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Couldn\'t play "a" - skipping.', "error");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("a genuine track change re-enables retry for the new track", async () => {
    usePlayerStore.getState().setQueue([t("a"), t("b")], 0, "Mix");
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValue({ position: 0, duration: 0, buffered: 0 });
    (resolveTrackUrl as jest.Mock).mockResolvedValue({ url: "https://r2/fresh", fromCache: false });
    __emit("playback-active-track-changed", { index: 0 });
    await flush();
    __emit("playback-error", { code: "x", message: "boom" }); // retry 1, track a
    await flush();
    __emit("playback-active-track-changed", { index: 1 }); // real change to track b
    await flush();
    __emit("playback-error", { code: "x", message: "boom" }); // retry 1, track b
    await flush();
    expect(TrackPlayer.load).toHaveBeenCalledTimes(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it("installs metadata triggers at service start and fires onPlaybackStarted when playing", async () => {
    const { installMetadataTriggers, onPlaybackStarted } = jest.requireMock("./metadata/triggers");
    expect(installMetadataTriggers).toHaveBeenCalled(); // from beforeEach's playbackService()
    __emit("playback-state", { state: State.Playing });
    await flush();
    expect(onPlaybackStarted).toHaveBeenCalled();
    __emit("playback-state", { state: State.Paused });
    await flush();
    expect(onPlaybackStarted).toHaveBeenCalledTimes(1);
  });
});

describe("headless language", () => {
  it("boots the language before registering the service's handlers", async () => {
    const ensure = jest.spyOn(i18n, "ensureI18n");
    const triggers = jest.requireMock("./metadata/triggers").installMetadataTriggers as jest.Mock;
    triggers.mockClear();
    await playbackService();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(triggers.mock.invocationCallOrder[0]);
    ensure.mockRestore();
  });
});