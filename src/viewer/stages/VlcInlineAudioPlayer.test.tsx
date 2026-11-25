/**
 * Same mock arrangement as VlcVideoStage.test.tsx: the native side cannot run
 * under jest, so a stand-in records props and lets tests fire player events.
 * Under test: the no-autoplay contract, the transport, and honest failure.
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
import { VlcInlineAudioPlayer } from "./VlcInlineAudioPlayer";

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeProps = {};
  mockViewAvailable = true;
});

it("starts paused - a details screen is not a player the user asked to start", () => {
  render(<VlcInlineAudioPlayer uri="https://r2.test/song.ogg" />);
  expect(mockNativeProps.uri).toBe("https://r2.test/song.ogg");
  expect(mockNativeProps.paused).toBe(true);
});

it("plays on tap and reports the duration upward once the demuxer knows it", () => {
  const onDuration = jest.fn();
  render(<VlcInlineAudioPlayer uri="https://r2.test/song.ogg" onDuration={onDuration} />);
  fireEvent.press(screen.getByTestId("vlc-audio-play-pause"));
  expect(mockNativeProps.paused).toBe(false);
  act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration: 245 } }));
  expect(onDuration).toHaveBeenCalledWith(245);
});

it("seeks proportionally once loaded, and not before", () => {
  render(<VlcInlineAudioPlayer uri="https://r2.test/song.ogg" />);
  // The pre-load bar is disabled; RNTL blocks every event on a disabled
  // element (on a device onLayout is native and still fires), so the press
  // is swallowed here - which is exactly the "not before" contract.
  fireEvent.press(screen.getByTestId("vlc-audio-seek-bar"), { nativeEvent: { locationX: 50 } });
  expect(mockSeekTo).not.toHaveBeenCalled(); // duration still unknown
  act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration: 100 } }));
  fireEvent(screen.getByTestId("vlc-audio-seek-bar"), "layout", { nativeEvent: { layout: { width: 200 } } });
  fireEvent.press(screen.getByTestId("vlc-audio-seek-bar"), { nativeEvent: { locationX: 50 } });
  expect(mockSeekTo).toHaveBeenCalledWith(25);
});

it("turns into replay at the end and restarts from zero", () => {
  render(<VlcInlineAudioPlayer uri="https://r2.test/song.ogg" />);
  act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration: 100 } }));
  act(() => mockNativeProps.onEnd?.());
  expect(mockNativeProps.paused).toBe(true);
  fireEvent.press(screen.getByLabelText("Replay"));
  expect(mockSeekTo).toHaveBeenCalledWith(0);
  expect(mockNativeProps.paused).toBe(false);
});

it("admits failure in one honest line", () => {
  render(<VlcInlineAudioPlayer uri="https://r2.test/song.ogg" />);
  act(() => mockNativeProps.onError?.({ nativeEvent: { message: "boom" } }));
  expect(screen.getByTestId("vlc-audio-failed")).toBeTruthy();
  expect(screen.queryByTestId("vlc-inline-audio")).toBeNull();
});

it("renders nothing at all in a build without the module", () => {
  mockViewAvailable = false;
  render(<VlcInlineAudioPlayer uri="https://r2.test/song.ogg" />);
  expect(screen.queryByTestId("vlc-inline-audio")).toBeNull();
  expect(screen.queryByTestId("vlc-audio-failed")).toBeNull();
});
