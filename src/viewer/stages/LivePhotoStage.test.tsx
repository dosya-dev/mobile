import { render, fireEvent, act } from "@testing-library/react-native";

// A single shared player, matching real expo-video: useVideoPlayer memoises
// the handle per source, so the test double must too - a fresh object per
// render would hide bugs where the component reaches for a stale player
// (and previously caused the component to grow a play path that existed only
// to work around this exact mismatch).
const mockPlayer = { play: jest.fn(), pause: jest.fn(), currentTime: 0, muted: false, loop: false, addListener: jest.fn(() => ({ remove: jest.fn() })) };

jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn((_src: unknown, setup?: (p: unknown) => void) => {
    setup?.(mockPlayer);
    return mockPlayer;
  }),
  VideoView: (props: { testID?: string }) => { const { View } = require("react-native"); return <View testID={props.testID ?? "video-view"} />; },
}));
jest.mock("expo-image", () => ({ Image: (props: { testID?: string }) => { const { View } = require("react-native"); return <View testID={props.testID} />; } }));
import { LivePhotoStage } from "./LivePhotoStage";

const palette = { fgMuted: "#888" } as never;

describe("LivePhotoStage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayer.currentTime = 0;
  });

  it("plays the twin on long press and stops on release", () => {
    const { getByTestId, queryByTestId } = render(
      <LivePhotoStage uri="https://api/raw/s" twinUri="https://api/raw/v" twinHeaders={{ Authorization: "Bearer t" }} palette={palette} />,
    );
    expect(queryByTestId("live-video")).toBeNull();
    fireEvent(getByTestId("live-stage"), "longPress");
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(getByTestId("live-video")).toBeTruthy();
    fireEvent(getByTestId("live-stage"), "pressOut");
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(queryByTestId("live-video")).toBeNull();
  });

  it("badge tap plays once", () => {
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <LivePhotoStage uri="u" twinUri="v" palette={palette} />,
    );
    fireEvent.press(getByLabelText("Play Live Photo"));
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(getByTestId("live-video")).toBeTruthy();
    const listenerCall = (mockPlayer.addListener as jest.Mock).mock.calls.find(([event]: [string]) => event === "playToEnd");
    expect(listenerCall).toBeTruthy();
    act(() => { listenerCall![1](); });
    expect(queryByTestId("live-video")).toBeNull();
  });

  it("stops the video view when the twin reports playToEnd", () => {
    const { getByTestId, queryByTestId } = render(
      <LivePhotoStage uri="https://api/raw/s" twinUri="https://api/raw/v" palette={palette} />,
    );
    fireEvent(getByTestId("live-stage"), "longPress");
    expect(getByTestId("live-video")).toBeTruthy();
    const listenerCall = (mockPlayer.addListener as jest.Mock).mock.calls.find(([event]: [string]) => event === "playToEnd");
    expect(listenerCall).toBeTruthy();
    act(() => { listenerCall![1](); });
    expect(queryByTestId("live-video")).toBeNull();
  });
});
