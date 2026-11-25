import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { InfoSheet } from "./InfoSheet";
import { useMetadataStore } from "./metadata/metadataStore";
import { ThemeProvider } from "@/theme/ThemeProvider";
import type { PlayerTrack } from "./types";

jest.mock("./cache", () => ({ getCachedUri: jest.fn(async () => null) }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => { throw new Error("ENOENT"); }),
  writeAsStringAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  deleteAsync: jest.fn(async () => {}),
}));

const track: PlayerTrack = { fileId: "a", title: "fallback-name", artist: "Mix", extension: "mp3", sizeBytes: 4_000_000, modifiedAt: 1720000000 };

beforeEach(() => useMetadataStore.getState()._resetForTests());

describe("InfoSheet", () => {
  it("shows extracted tags plus file facts, omitting unknown rows", () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Real Title", artist: "Real Artist", durationSec: 185, bitrateKbps: 128, sizeBytes: 4_000_000, modifiedAt: 1720000000 });
    const { getByText, queryByText, getByTestId } = render(<ThemeProvider><InfoSheet track={track} visible onClose={() => {}} /></ThemeProvider>);
    expect(getByTestId("info-sheet")).toBeTruthy();
    expect(getByText("Real Title")).toBeTruthy();
    expect(getByText("Real Artist")).toBeTruthy();
    expect(getByText("3:05")).toBeTruthy();
    expect(getByText("128 kbps")).toBeTruthy();
    expect(getByText("3.8 MB")).toBeTruthy();
    expect(queryByText("Album")).toBeNull();
  });

  it("falls back to the filename title when nothing was extracted", () => {
    const { getByText } = render(<ThemeProvider><InfoSheet track={track} visible onClose={() => {}} /></ThemeProvider>);
    expect(getByText("fallback-name")).toBeTruthy();
  });

  it("keeps the Modified row clear of the Android navigation bar", () => {
    // The app draws edge-to-edge and a Modal renders in its own window, outside
    // any SafeAreaView - so with a fixed pb-8 (32dp) the last rows of this
    // sheet, Type and Modified, sat behind a ~48dp three-button bar.
    const NAV_BAR = 48;
    const { getByTestId } = render(
      <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: NAV_BAR, left: 0, right: 0 }}>
        <ThemeProvider><InfoSheet track={track} visible onClose={() => {}} /></ThemeProvider>
      </SafeAreaInsetsContext.Provider>,
    );
    const style = StyleSheet.flatten(getByTestId("info-sheet").props.style);
    expect(style.paddingBottom).toBeGreaterThan(NAV_BAR);
  });

  it("closes on a backdrop tap", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<ThemeProvider><InfoSheet track={track} visible onClose={onClose} /></ThemeProvider>);
    fireEvent.press(getByTestId("info-sheet-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when tapping the card content", () => {
    const onClose = jest.fn();
    const { getByText } = render(<ThemeProvider><InfoSheet track={track} visible onClose={onClose} /></ThemeProvider>);
    fireEvent.press(getByText("fallback-name"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
