import TrackPlayer, { Event, State } from "react-native-track-player";
import { installHistoryHooks } from "./historyHooks";
import { usePlayerStore } from "@/player/playerStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import * as recents from "./recents";

jest.mock("./recents");
// __emit/__reset aren't in the real package's types (only the manual mock at
// __mocks__/react-native-track-player.js has them) - jest.requireMock() gets
// a typed-as-any handle on the same mock instance the plain import above
// already resolves to. Same pattern as src/player/service.test.ts.
jest.mock("react-native-track-player");
const { __emit, __reset } = jest.requireMock("react-native-track-player");

describe("installHistoryHooks", () => {
  beforeEach(() => {
    __reset();
    jest.clearAllMocks();
    usePlayerStore.setState({
      queue: [{ fileId: "a1", title: "Track 1", artist: "Podcasts", extension: "mp3", sizeBytes: 1, modifiedAt: 0 }],
      index: 0,
      sourceName: "Podcasts",
    } as any);
    useWorkspaceStore.setState({ activeId: "ws1" } as any);
    installHistoryHooks();
  });

  it("writes a current-playback row when the active track changes", async () => {
    __emit(Event.PlaybackActiveTrackChanged, { index: 0 });
    await Promise.resolve();
    expect(recents.setCurrentPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "a1", title: "Track 1", sourceName: "Podcasts" }),
      expect.any(Number),
    );
    expect(recents.pushRecent).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "a1" }),
      expect.any(Number),
    );
  });

  it("checkpoints position on progress updates", async () => {
    __emit(Event.PlaybackProgressUpdated, { position: 42, duration: 120, buffered: 100 });
    await Promise.resolve();
    expect(recents.updatePlaybackPosition).toHaveBeenCalledWith("a1", 42, expect.any(Number));
  });

  // Progress events are now rare, so a pause has to save the spot itself.
  it("saves the position when playback pauses", async () => {
    (TrackPlayer.getProgress as jest.Mock).mockResolvedValueOnce({ position: 77, duration: 120, buffered: 100 });
    __emit(Event.PlaybackState, { state: State.Paused });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recents.updatePlaybackPosition).toHaveBeenCalledWith("a1", 77, expect.any(Number));
  });

  it("does not write on any other state change", async () => {
    __emit(Event.PlaybackState, { state: State.Playing });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recents.updatePlaybackPosition).not.toHaveBeenCalled();
  });
});
