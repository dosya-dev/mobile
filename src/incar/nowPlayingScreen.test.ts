import { Platform } from "react-native";
Platform.OS = "ios";

import { installCarPlayNowPlaying } from "./nowPlayingScreen";
import * as carplay from "react-native-carplay";
import TrackPlayer, { Event } from "react-native-track-player";

// __emit/__reset aren't in the real package's types (only the manual mock at
// __mocks__/react-native-track-player.js has them) - jest.requireMock() gets
// a typed-as-any handle on the same mock instance the plain import above
// already resolves to. Same pattern as src/player/service.test.ts.
jest.mock("react-native-track-player");
const { __emit, __reset } = jest.requireMock("react-native-track-player");

const mockedCarplay = carplay as unknown as { CarPlay: any; __reset: Function; __stack: Function };

describe("installCarPlayNowPlaying", () => {
  beforeEach(() => {
    mockedCarplay.__reset();
    __reset();
    jest.clearAllMocks();
    installCarPlayNowPlaying();
  });

  it("enables CarPlay's now-playing observer once, at install time", () => {
    expect(mockedCarplay.CarPlay.enableNowPlaying).toHaveBeenCalledWith(true);
  });

  it("pushes the Now Playing template when playback starts", async () => {
    __emit(Event.PlaybackState, { state: "playing" });
    await Promise.resolve();
    expect(mockedCarplay.CarPlay.pushTemplate).toHaveBeenCalled();
  });
});
