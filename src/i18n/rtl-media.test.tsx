/**
 * Media and documents in right-to-left languages: a timeline is a physical
 * thing (left is the start of the track), a document follows its own language.
 */
const mockSeekTo = jest.fn();
const mockTrackSeek = jest.fn();
let mockNativeProps: Record<string, unknown> & {
  onLoaded?: (e: { nativeEvent: { duration: number } }) => void;
};

jest.mock("../viewer/vlcPlayer", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual("react-native");
  const Native = React.forwardRef(function MockVlcView(props: Record<string, unknown>, ref) {
    React.useImperativeHandle(ref, () => ({ seekTo: mockSeekTo }));
    mockNativeProps = props;
    return React.createElement(View, { testID: "vlc-native" });
  });
  return { isVlcAvailable: () => true, vlcVideoView: () => Native };
});
jest.mock("react-native-track-player", () => {
  const actual = {
    __esModule: true,
    default: { seekTo: (...a: unknown[]) => mockTrackSeek(...a) },
    useProgress: () => ({ position: 10, duration: 100, buffered: 0 }),
    State: {}, Event: {}, RepeatMode: {}, Capability: {},
  };
  return actual;
});

import { act, fireEvent, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderInLocale, type ReactTestInstance } from "../../test-utils/i18n-sweep";
import { __resetI18nForTests } from "@/lib/i18n";
import { VlcVideoStage } from "../viewer/stages/VlcVideoStage";
import { VlcInlineAudioPlayer } from "../viewer/stages/VlcInlineAudioPlayer";
import { MarkdownStage } from "../viewer/stages/MarkdownStage";
import { TextStage } from "../viewer/stages/TextStage";
import { CsvStage } from "../viewer/stages/CsvStage";
import PlayerScreen from "../../app/player";
import { usePlayerStore } from "@/player/playerStore";
import { ThemeProvider } from "@/theme/ThemeProvider";

jest.mock("@/player/controller", () => ({
  togglePlay: jest.fn(), next: jest.fn(), previous: jest.fn(), jumpTo: jest.fn(), toggleShuffle: jest.fn(), cycleRepeat: jest.fn(),
}));
jest.mock("@/files/api", () => ({ getFavourites: jest.fn(async () => ({ files: [], folders: [] })) }));
jest.mock("@/files/mutations", () => ({ addFavourite: jest.fn(), removeFavourite: jest.fn() }));
jest.mock("@/groups/AddToGroupSheet", () => ({ AddToGroupSheet: () => null }));
jest.mock("expo-router", () => {
  const router = { push: jest.fn(), back: jest.fn() };
  return { useRouter: () => router };
});

afterEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
});

const flat = (n: ReactTestInstance) => (StyleSheet.flatten(n.props?.style as never) ?? {}) as Record<string, unknown>;
function hasLtrAncestor(node: ReactTestInstance): boolean {
  for (let p = node.parent; p; p = p.parent) if (typeof p.type === "string" && flat(p).direction === "ltr") return true;
  return false;
}
const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 400, height: 800 };

describe("seek bars stay left to right", () => {
  it("VlcVideoStage in ar: a tap at 90 percent seeks to 90 percent", async () => {
    await renderInLocale(
      <SafeAreaInsetsContext.Provider value={insets}>
        <VlcVideoStage uri="https://r2.test/a.mkv" onDuration={jest.fn()} onSave={jest.fn()} onRetry={jest.fn()} />
      </SafeAreaInsetsContext.Provider>,
      "ar",
    );
    act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration: 100 } }));
    const bar = screen.getByTestId("vlc-seek-bar");
    expect(hasLtrAncestor(bar as unknown as ReactTestInstance)).toBe(true);
    expect(hasLtrAncestor(screen.getByTestId("vlc-play-pause") as unknown as ReactTestInstance)).toBe(true);
    fireEvent(bar, "layout", { nativeEvent: { layout: { width: 200 } } });
    fireEvent.press(bar, { nativeEvent: { locationX: 0.9 * 200 } });
    expect(mockSeekTo).toHaveBeenCalledWith(90);
  });

  it("VlcInlineAudioPlayer in ar: ltr ancestor and 90 percent", async () => {
    await renderInLocale(<VlcInlineAudioPlayer uri="https://r2.test/a.ogg" />, "ar");
    act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration: 100 } }));
    const bar = screen.getByTestId("vlc-audio-seek-bar");
    expect(hasLtrAncestor(bar as unknown as ReactTestInstance)).toBe(true);
    fireEvent(bar, "layout", { nativeEvent: { layout: { width: 200 } } });
    fireEvent.press(bar, { nativeEvent: { locationX: 180 } });
    expect(mockSeekTo).toHaveBeenCalledWith(90);
  });

  it("the player screen: seek bar and transport row sit in ltr islands", async () => {
    usePlayerStore.getState().setQueue(
      [{ fileId: "a", title: "first", artist: "x", extension: "mp3", sizeBytes: 1, modifiedAt: 1 }],
      0,
      "x",
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
    await renderInLocale(
      <ThemeProvider><QueryClientProvider client={qc}><PlayerScreen /></QueryClientProvider></ThemeProvider>,
      "ar",
    );
    for (const id of ["seek-bar", "player-previous", "player-next"]) {
      expect(hasLtrAncestor(screen.getByTestId(id) as unknown as ReactTestInstance)).toBe(true);
    }
    const bar = screen.getByTestId("seek-bar");
    fireEvent(bar, "layout", { nativeEvent: { layout: { width: 200 } } });
    fireEvent.press(bar, { nativeEvent: { locationX: 180 } });
    expect(mockTrackSeek).toHaveBeenCalledWith(90);
    void frame;
  });
});

function contentDirs(): unknown[] {
  return screen.UNSAFE_root
    .findAll((n: ReactTestInstance) => typeof n.type === "string" && "direction" in flat(n))
    .map((n: ReactTestInstance) => flat(n).direction);
}

describe("documents follow their own direction", () => {
  const stageProps = { mimeType: "text/markdown", extension: "md", mutedColor: "#888" };

  it("Markdown: a Hebrew document in en is rtl, an English one in ar is ltr", async () => {
    await renderInLocale(<MarkdownStage text={"# שלום\n\nעולם"} mutedColor="#888" />, "en");
    expect(contentDirs()).toContain("rtl");
    __resetI18nForTests();
    await renderInLocale(<MarkdownStage text={"# Hello\n\nworld"} mutedColor="#888" />, "ar");
    expect(contentDirs()).toContain("ltr");
    expect(contentDirs()).not.toContain("rtl");
  });

  it("Text and CSV stages carry the document's direction", async () => {
    await renderInLocale(<TextStage text={"مرحبا\nworld"} {...stageProps} extension="txt" />, "en");
    expect(contentDirs()).toContain("rtl");
    __resetI18nForTests();
    await renderInLocale(<CsvStage text={"a,b\n1,2\n3,4"} {...stageProps} extension="csv" mimeType="text/csv" />, "ar");
    expect(contentDirs()).toContain("ltr");
    expect(contentDirs()).not.toContain("rtl");
  });
});
