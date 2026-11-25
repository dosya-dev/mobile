/**
 * The native side cannot run under jest, so the mock below stands in for the
 * libVLC view: it records the props the stage hands it and lets each test
 * fire the events a real player would. What is under test is the stage's
 * contract - autoplay, the controls, the stall overlay that must NOT unmount
 * the player, and failure handling.
 */
const mockSeekTo = jest.fn();
let mockNativeProps: Record<string, unknown> & {
  uri?: string | null;
  paused?: boolean;
  onLoaded?: (e: { nativeEvent: { duration: number } }) => void;
  onProgress?: (e: { nativeEvent: { time: number; duration: number; position: number } }) => void;
  onEnd?: () => void;
  onError?: (e: { nativeEvent: { message: string } }) => void;
};
let mockViewAvailable = true;

jest.mock("../vlcPlayer", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual("react-native");
  const Native = React.forwardRef(function MockVlcView(props: Record<string, unknown>, ref) {
    React.useImperativeHandle(ref, () => ({ seekTo: mockSeekTo }));
    mockNativeProps = props;
    return React.createElement(View, { testID: "vlc-native" });
  });
  return {
    isVlcAvailable: () => mockViewAvailable,
    vlcVideoView: () => (mockViewAvailable ? Native : null),
  };
});

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { VlcVideoStage } from "./VlcVideoStage";
import { BUFFER_TIMEOUT_MS } from "../videoSupport";

function renderStage(over: Partial<React.ComponentProps<typeof VlcVideoStage>> = {}) {
  return render(
    <VlcVideoStage uri="https://r2.test/presigned.mkv" onDuration={jest.fn()} onSave={jest.fn()} onRetry={jest.fn()} {...over} />,
  );
}

function load(duration = 100) {
  act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration } }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeProps = {};
  mockViewAvailable = true;
});

it("hands the presigned url straight to libVLC and autoplays", () => {
  renderStage();
  expect(screen.getByTestId("vlc-native")).toBeTruthy();
  expect(mockNativeProps.uri).toBe("https://r2.test/presigned.mkv");
  expect(mockNativeProps.paused).toBe(false);
});

it("keeps the transport controls clear of the Android navigation bar", () => {
  // The stage fills the screen with no SafeAreaView anywhere above it, and in
  // immersive mode the viewer sheet that normally covers this bar is slid away
  // - so with a flat pb-4 the play/pause button and the scrub bar sat behind a
  // ~48dp three-button bar.
  const NAV_BAR = 48;
  render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: NAV_BAR, left: 0, right: 0 }}>
      <VlcVideoStage uri="https://r2.test/presigned.mkv" />
    </SafeAreaInsetsContext.Provider>,
  );
  load();
  const style = StyleSheet.flatten(screen.getByTestId("vlc-controls").props.style);
  expect(style.bottom).toBeGreaterThan(NAV_BAR);
});

it("reports the duration upward, which is what proves playback really started", () => {
  const onDuration = jest.fn();
  renderStage({ onDuration });
  load(123);
  expect(onDuration).toHaveBeenCalledWith(123);
});

it("shows no controls before the first frame - the player's own black is enough", () => {
  renderStage();
  expect(screen.queryByTestId("vlc-play-pause")).toBeNull();
  load();
  expect(screen.getByTestId("vlc-play-pause")).toBeTruthy();
});

it("pauses and resumes through the paused prop", () => {
  renderStage();
  load();
  fireEvent.press(screen.getByTestId("vlc-play-pause"));
  expect(mockNativeProps.paused).toBe(true);
  fireEvent.press(screen.getByTestId("vlc-play-pause"));
  expect(mockNativeProps.paused).toBe(false);
});

it("seeks proportionally to where the bar was tapped", () => {
  renderStage();
  load(100);
  const bar = screen.getByTestId("vlc-seek-bar");
  fireEvent(bar, "layout", { nativeEvent: { layout: { width: 200 } } });
  fireEvent.press(bar, { nativeEvent: { locationX: 100 } });
  expect(mockSeekTo).toHaveBeenCalledWith(50);
});

it("ignores taps on the bar while the duration is still unknown", () => {
  renderStage();
  load(0); // a length-less stream: playing, but nothing to scrub
  act(() => mockNativeProps.onProgress?.({ nativeEvent: { time: 3, duration: 0, position: 0 } }));
  const bar = screen.getByTestId("vlc-seek-bar");
  fireEvent(bar, "layout", { nativeEvent: { layout: { width: 200 } } });
  fireEvent.press(bar, { nativeEvent: { locationX: 100 } });
  expect(mockSeekTo).not.toHaveBeenCalled();
});

it("turns the pause button into replay at the end, and replay starts from zero", () => {
  renderStage();
  load(100);
  act(() => mockNativeProps.onEnd?.());
  expect(mockNativeProps.paused).toBe(true);
  fireEvent.press(screen.getByLabelText("Replay"));
  expect(mockSeekTo).toHaveBeenCalledWith(0);
  expect(mockNativeProps.paused).toBe(false);
});

it("admits failure when libVLC gives up, and offers both ways out", () => {
  const onRetry = jest.fn();
  renderStage({ onRetry });
  act(() => mockNativeProps.onError?.({ nativeEvent: { message: "boom" } }));
  expect(screen.getByTestId("vlc-failed")).toBeTruthy();
  expect(screen.queryByTestId("vlc-native")).toBeNull();
  fireEvent.press(screen.getByTestId("vlc-failed-retry"));
  expect(onRetry).toHaveBeenCalled();
});

it("a fresh uri from retry clears the failure and mounts a new player", () => {
  const { rerender } = renderStage();
  act(() => mockNativeProps.onError?.({ nativeEvent: { message: "boom" } }));
  expect(screen.getByTestId("vlc-failed")).toBeTruthy();
  rerender(<VlcVideoStage uri="https://r2.test/presigned-2.mkv" />);
  expect(screen.queryByTestId("vlc-failed")).toBeNull();
  expect(screen.getByTestId("vlc-native")).toBeTruthy();
});

describe("when the first frame is slow", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("keeps quiet at first, because a slow start is normal", () => {
    renderStage();
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS - 1000); });
    expect(screen.queryByTestId("vlc-stalled")).toBeNull();
  });

  it("overlays the stall message WITHOUT unmounting the player", () => {
    renderStage();
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS); });
    expect(screen.getByTestId("vlc-stalled")).toBeTruthy();
    // The stream must survive its own progress indicator: a first frame at
    // second sixteen still has a player to arrive in.
    expect(screen.getByTestId("vlc-native")).toBeTruthy();
  });

  it("dismisses the overlay by itself when the frame finally arrives", () => {
    renderStage();
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS); });
    expect(screen.getByTestId("vlc-stalled")).toBeTruthy();
    load();
    expect(screen.queryByTestId("vlc-stalled")).toBeNull();
    expect(screen.getByTestId("vlc-play-pause")).toBeTruthy();
  });

  it("never fires while there is no source to wait on", () => {
    renderStage({ uri: null });
    act(() => { jest.advanceTimersByTime(BUFFER_TIMEOUT_MS * 2); });
    expect(screen.queryByTestId("vlc-stalled")).toBeNull();
  });
});

it("renders an inert dark stage rather than throwing when the build has no libVLC", () => {
  mockViewAvailable = false;
  renderStage();
  expect(screen.getByTestId("vlc-stage-unavailable")).toBeTruthy();
});
