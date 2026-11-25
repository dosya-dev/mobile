jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn(() => ({ duration: 0, addListener: () => ({ remove: () => {} }) })),
  VideoView: "VideoView",
}));

// Default is the world before modules/dosya-vlc-player existed: Android, Expo
// Go, and every dev client built earlier. Tests that want libVLC flip it on.
let mockVlcAvailable = false;
jest.mock("../vlcPlayer", () => ({
  isVlcAvailable: () => mockVlcAvailable,
}));

jest.mock("./VlcVideoStage", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual("react-native");
  return {
    VlcVideoStage: () => React.createElement(View, { testID: "vlc-stage" }),
  };
});

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { VideoStage } from "./VideoStage";
import { BUFFER_TIMEOUT_MS } from "../videoSupport";

function renderStage(over: Partial<React.ComponentProps<typeof VideoStage>> = {}) {
  return render(
    <VideoStage
      uri="https://r2.test/presigned"
      mimeType="video/mp4"
      extension=".mp4"
      onSave={jest.fn()}
      onRetry={jest.fn()}
      {...over}
    />,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  (Platform as unknown as { OS: string }).OS = "ios";
  mockVlcAvailable = false;
});
afterEach(() => jest.useRealTimers());

it("plays a format the phone can decode", () => {
  renderStage();
  expect(screen.getByTestId("video-stage")).toBeTruthy();
  expect(screen.queryByTestId("video-unplayable")).toBeNull();
});

// The current behaviour is a black rectangle that never starts, which reads
// exactly like a slow connection.
it("says which format an iPhone cannot open, instead of showing black", () => {
  renderStage({ mimeType: "video/x-matroska", extension: ".mkv" });
  expect(screen.getByTestId("video-unplayable")).toBeTruthy();
  expect(screen.getByText(/Matroska/)).toBeTruthy();
  expect(screen.queryByTestId("video-stage")).toBeNull();
});

it("offers the only thing that actually helps for a format it cannot open", () => {
  const onSave = jest.fn();
  renderStage({ mimeType: "video/x-matroska", extension: ".mkv", onSave });
  fireEvent.press(screen.getByTestId("video-unplayable-save"));
  expect(onSave).toHaveBeenCalled();
});

it("hands the same file to Android, which can decode it", () => {
  (Platform as unknown as { OS: string }).OS = "android";
  renderStage({ mimeType: "video/x-matroska", extension: ".mkv" });
  expect(screen.getByTestId("video-stage")).toBeTruthy();
});

describe("with libVLC in the build", () => {
  beforeEach(() => {
    mockVlcAvailable = true;
  });

  it("routes an MKV to the libVLC stage instead of the card", () => {
    renderStage({ mimeType: "video/x-matroska", extension: ".mkv" });
    expect(screen.getByTestId("vlc-stage")).toBeTruthy();
    expect(screen.queryByTestId("video-unplayable")).toBeNull();
    expect(screen.queryByTestId("video-stage")).toBeNull();
  });

  it("keeps the card for a view-only file, whose bytes need an auth header libVLC cannot send", () => {
    renderStage({
      mimeType: "video/x-matroska",
      extension: ".mkv",
      headers: { Authorization: "Bearer t" },
    });
    expect(screen.getByTestId("video-unplayable")).toBeTruthy();
    expect(screen.queryByTestId("vlc-stage")).toBeNull();
  });

  it("leaves formats AVPlayer handles on the native player", () => {
    renderStage();
    expect(screen.getByTestId("video-stage")).toBeTruthy();
    expect(screen.queryByTestId("vlc-stage")).toBeNull();
  });
});

describe("when the first frame never arrives", () => {
  it("keeps quiet at first, because a slow start is normal", () => {
    renderStage();
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS - 1000); });
    expect(screen.queryByTestId("video-stalled")).toBeNull();
  });

  it("admits it does not know, once waiting has stopped being normal", () => {
    renderStage();
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS); });
    expect(screen.getByTestId("video-stalled")).toBeTruthy();
    // Both, because at this point the app genuinely cannot tell which it is.
    expect(screen.getByTestId("video-stalled-retry")).toBeTruthy();
    expect(screen.getByTestId("video-stalled-save")).toBeTruthy();
  });

  it("never fires while there is no source to wait on", () => {
    renderStage({ uri: null });
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS * 2); });
    expect(screen.queryByTestId("video-stalled")).toBeNull();
  });

  it("stops warning once the video reports a duration", () => {
    const { rerender } = renderStage();
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS); });
    expect(screen.getByTestId("video-stalled")).toBeTruthy();
    rerender(
      <VideoStage uri="https://r2.test/presigned" mimeType="video/mp4" extension=".mp4" playing />,
    );
    expect(screen.queryByTestId("video-stalled")).toBeNull();
  });
});
