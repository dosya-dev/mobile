/**
 * Unit E (viewers, reader, player, CarPlay, orbit) in the chosen language.
 *
 * Each screen renders under I18nProvider in Turkish and nothing the catalog
 * knows may stay English; a language switch while mounted changes the text in
 * place; every plural the unit wires reads right in Polish for 1, 3 and 5.
 */
import { act, fireEvent, screen, render, waitFor } from "@testing-library/react-native";
import { Platform, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { collectTexts, leftoverEnglish, renderInLocale } from "../../../test-utils/i18n-sweep";
import { __resetI18nForTests, loadMessages, t as moduleT, useLocale, useT, I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";

// ---- mocks (names start with "mock" so babel-plugin-jest-hoist allows them) ----
const mockDownloadAsync = jest.fn();
jest.mock("expo-file-system/legacy", () => ({
  ...jest.requireActual("expo-file-system/legacy"),
  createDownloadResumable: jest.fn(() => ({ downloadAsync: mockDownloadAsync })),
}));
const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/files/download", () => ({ shareFile: jest.fn(async () => {}) }));
jest.mock("@/files/api", () => ({ getFavourites: jest.fn(async () => ({ files: [], folders: [] })) }));
jest.mock("@/files/mutations", () => ({ addFavourite: jest.fn(async () => ({})), removeFavourite: jest.fn(async () => ({})) }));
jest.mock("@/groups/AddToGroupSheet", () => ({ AddToGroupSheet: () => null }));
jest.mock("@/files/downloadControl", () => ({ cancelDownload: jest.fn(async () => {}) }));
jest.mock("@/upload/controller", () => ({ retryItem: jest.fn(), startUploads: jest.fn() }));
jest.mock("@/upload/startFromPicker", () => ({ startFromPicker: jest.fn(async () => {}) }));
jest.mock("@/player/controller", () => {
  const actual = jest.requireActual("@/player/controller");
  return {
    ...actual,
    togglePlay: jest.fn(async () => {}), next: jest.fn(async () => {}), previous: jest.fn(async () => {}),
    jumpTo: jest.fn(async () => {}), toggleShuffle: jest.fn(async () => {}), cycleRepeat: jest.fn(async () => {}),
    stopAndClear: jest.fn(async () => {}),
  };
});
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn(), duration: 0, addListener: () => ({ remove: () => {} }) })),
  VideoView: "VideoView",
}));
jest.mock("expo-image", () => ({ Image: (props: { testID?: string }) => { const { View } = require("react-native"); return <View testID={props.testID} />; } }));
jest.mock("react-native-pdf");
jest.mock("./../../reader/readingState", () => {
  const actual = jest.requireActual("./../../reader/readingState");
  const mockLoad = jest.fn(async () => ({ version: 1, location: null, percent: 0, bookmarks: [{ id: "b1", location: "page:2", label: "Chapter 2 · 20%", createdAt: "2025-07-10T10:00:00Z" }] }));
  return {
    ...actual,
    loadReadingState: mockLoad,
    saveReadingState: jest.fn(async () => {}),
    createPositionSaver: jest.fn(() => ({ update: jest.fn(), flush: jest.fn(async () => {}) })),
    updateReadingState: jest.fn(async (_id: string, mutate: (s: unknown) => unknown) => mutate(await mockLoad())),
  };
});
jest.mock("./../../reader/chunkDelivery", () => ({ deliverBook: jest.fn(async () => {}) }));

const mockInjected: string[] = [];
let mockWebviewProps: Record<string, unknown> = {};
jest.mock("react-native-webview", () => {
  const React = require("react");
  const WebView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    mockWebviewProps = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => mockInjected.push(js) }));
    return null;
  });
  WebView.displayName = "WebView";
  return { WebView, default: WebView };
});

let mockVlcAvailable = true;
let mockNativeProps: Record<string, unknown> & {
  onLoaded?: (e: { nativeEvent: { duration: number } }) => void;
  onEnd?: () => void;
  onError?: (e: unknown) => void;
} = {};
jest.mock("./../../viewer/vlcPlayer", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual("react-native");
  const Native = React.forwardRef(function MockVlcView(props: Record<string, unknown>, ref) {
    React.useImperativeHandle(ref, () => ({ seekTo: jest.fn() }));
    mockNativeProps = props;
    return React.createElement(View, { testID: "vlc-native" });
  });
  return { isVlcAvailable: () => mockVlcAvailable, vlcVideoView: () => (mockVlcAvailable ? Native : null) };
});

import PlayerScreen from "../../../app/player";
import { usePlayerStore } from "@/player/playerStore";
import { useMetadataStore } from "@/player/metadata/metadataStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { InfoSheet } from "@/player/InfoSheet";
import { queueStats } from "@/player/queueStats";
import { playFolder, playSingleFile } from "@/player/controller";
import { toast } from "@/ui/toast";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { startFromPicker } from "@/upload/startFromPicker";
import { ViewerChrome } from "@/viewer/ViewerChrome";
import { ViewerActions } from "@/viewer/ViewerActions";
import { ViewerDetails } from "@/viewer/ViewerDetails";
import { ViewerSheet } from "@/viewer/ViewerSheet";
import { actionAvailability, detailRows, lockBadge, metaParts, primaryAction } from "@/viewer/viewerModel";
import { positionLabel } from "@/viewer/viewerStore";
import { containerLabel } from "@/viewer/videoSupport";
import { nextPreviewState } from "@/viewer/officePreview";
import { GlyphStage } from "@/viewer/stages/GlyphStage";
import { LockGate } from "@/viewer/stages/LockGate";
import { LivePhotoStage } from "@/viewer/stages/LivePhotoStage";
import { ImageStage } from "@/viewer/stages/ImageStage";
import { BookStage } from "@/viewer/stages/BookStage";
import { ContactsStage } from "@/viewer/stages/ContactsStage";
import { CsvStage } from "@/viewer/stages/CsvStage";
import { MarkdownStage } from "@/viewer/stages/MarkdownStage";
import { OfficeStage } from "@/viewer/stages/OfficeStage";
import { PdfStage } from "@/viewer/stages/PdfStage";
import { TextStage } from "@/viewer/stages/TextStage";
import { VideoStage } from "@/viewer/stages/VideoStage";
import { VlcVideoStage } from "@/viewer/stages/VlcVideoStage";
import { VlcInlineAudioPlayer } from "@/viewer/stages/VlcInlineAudioPlayer";
import { stagePalette } from "@/viewer/stageTheme";
import { BookReader } from "@/reader/BookReader";
import { PdfReader } from "@/reader/PdfReader";
import { ReaderMenu } from "@/reader/ReaderMenu";
import { ReaderChrome } from "@/reader/ReaderChrome";
import { TocSheet } from "@/reader/TocSheet";
import { ThemesSheet } from "@/reader/ThemesSheet";
import { SearchSheet } from "@/reader/SearchSheet";
import { errorCopy, jsInit, stageLabel } from "@/reader/bridge";
import { READING_THEMES, APP_READER_THEMES } from "@/reader/readerThemes";
import { flattenPdfOutline } from "@/reader/pdfToc";
import { THEME_LABEL_KEYS } from "@/theme/themeLabels";
import { OrbitSheet } from "@/orbit/OrbitSheet";
import { OrbitButton } from "@/orbit/OrbitButton";
import { orbitState, vaultSummary } from "@/orbit/orbitModel";
import { targetLabel, useUploadTarget } from "@/orbit/uploadTargetStore";
import { useDownloadStore } from "@/files/downloadStore";
import { useUploadStore } from "@/upload/store";
import { NO_VAULT_ACTIVITY, setVaultActivity } from "@/vault/status";
import { installCarPlayBrowseScreen } from "@/incar/browseScreen";
import * as bootstrap from "@/incar/bootstrap";
import * as browse from "@/incar/browse";
import * as recents from "@/incar/recents";
import * as carplay from "react-native-carplay";
import { resolveVoiceQuery } from "@/incar/voice";
import * as search from "@/incar/search";
import { ensureBookCached } from "@/reader/bookCache";
import { ApiError } from "@/api/errors";
import { parseVCardFile } from "@/contacts/vcardFile";

jest.mock("@/incar/bootstrap");
jest.mock("@/incar/browse");
jest.mock("@/incar/recents");
jest.mock("@/incar/search");
jest.mock("../../../modules/dosya-siri-search", () => ({ SiriSearch: {} }));

const palette = stagePalette("dark");
const hidden = { includeHiddenElements: true };
const pageMessage = (msg: object) => ({ nativeEvent: { data: JSON.stringify(msg) } });

afterEach(() => {
  __resetI18nForTests();
});

/** Everything on screen that is still English, minus allowed user data. */
const leftover = (locale: Locale, allow: string[] = []) => leftoverEnglish(collectTexts(), locale, { allow });

const file = (over: Record<string, unknown> = {}) =>
  ({
    id: "f1", name: "holiday.jpg", size_bytes: 2_400_000, mime_type: "image/jpeg", extension: ".jpg",
    created_at: 1_752_000_000, updated_at: 1_752_100_000, current_version: 3, lock_mode: "none", share_count: 2,
    comment_count: 0, uploader_name: "Ayse", region: null, folder_id: "fo1", ...over,
  }) as never;

const track = (fileId: string, title: string) => ({ fileId, title, artist: "Road trip", extension: "mp3", sizeBytes: 1, modifiedAt: 1 });

/** Polish forms of one plural message for 1, 3 and 5: all distinct once digits are removed. */
function expectPolishForms(run: (n: number) => string): void {
  const forms = [1, 3, 5].map((n) => run(n));
  forms.forEach((f, i) => {
    expect(f).toContain(String([1, 3, 5][i]));
    expect(f).not.toMatch(/[{}#]/);
  });
  const bare = forms.map((f) => f.replace(/\d+/g, "").trim());
  expect(new Set(bare).size).toBe(3);
}

async function inPolish(): Promise<void> {
  await renderInLocale(<></>, "pl");
}

// ============================ the player ============================

function renderPlayer(locale: Locale) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return renderInLocale(
    <ThemeProvider><QueryClientProvider client={qc}><PlayerScreen /></QueryClientProvider></ThemeProvider>,
    locale,
  );
}

describe("the player screen", () => {
  beforeEach(() => {
    usePlayerStore.getState().clear();
    useMetadataStore.getState()._resetForTests();
    useWorkspaceStore.setState({ activeId: "w1" });
  });

  it("is Turkish when nothing is queued", async () => {
    const r = await renderPlayer("tr");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByText(moduleT("audio.description.nothingPlaying"))).toBeTruthy();
  });

  it("is Turkish with a queue, its header and the track sheet", async () => {
    usePlayerStore.getState().setQueue([track("a", "first"), track("b", "second")], 0, "Road trip");
    useMetadataStore.setState({
      entries: {
        a: { fileId: "a", durationSec: 125, bitrateKbps: 320, sampleRateHz: 44100, sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: 2 },
        b: { fileId: "b", durationSec: 61, sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: 2 },
      },
    });
    const r = await renderPlayer("tr");
    fireEvent.press(screen.getByTestId("player-info"));
    expect(r.leftover({ allow: ["first", "second", "Road trip", "MP3"] })).toEqual([]);
    expect(screen.getByTestId("queue-header").props.children).toBeTruthy();
    expect(screen.getByLabelText(moduleT("audio.action.previousNextTrack"))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("audio.action.nextTrack"))).toBeTruthy();
  });

  it("switches language in place while mounted", async () => {
    usePlayerStore.getState().setQueue([track("a", "first")], 0, "Road trip");
    let api!: ReturnType<typeof useLocale>;
    const Probe = () => { api = useLocale(); return null; };
    const qc = new QueryClient();
    await renderInLocale(
      <ThemeProvider><QueryClientProvider client={qc}><PlayerScreen /><Probe /></QueryClientProvider></ThemeProvider>,
      "en",
    );
    expect(screen.getByLabelText("Shuffle")).toBeTruthy();
    expect(screen.getByLabelText("Previous track")).toBeTruthy();
    await act(async () => { await api.setPreference("de"); });
    expect(screen.getByLabelText((await loadMessages("de"))["audio.action.shuffle"])).toBeTruthy();
    expect(screen.queryByLabelText("Shuffle")).toBeNull();
  });

  it("English: the approved rewordings and the queue header", async () => {
    usePlayerStore.getState().setQueue([track("a", "first"), track("b", "second")], 0, "Road trip");
    useMetadataStore.setState({
      entries: {
        a: { fileId: "a", durationSec: 125, sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: 2 },
        b: { fileId: "b", durationSec: 61, sizeBytes: 1, modifiedAt: 1, parsedAt: 1, parserVersion: 2 },
      },
    });
    await renderPlayer("en");
    expect(screen.getByLabelText("Previous track")).toBeTruthy();
    expect(screen.getByLabelText("Next track")).toBeTruthy();
    expect(collectTexts()).toContain("2 tracks - 3 min");
  });

  it("queue header and totals: plurals in Polish for 1, 3 and 5", async () => {
    await inPolish();
    const q = (n: number) => Array.from({ length: n }, (_, i) => track(`t${i}`, `t${i}`));
    const entries = (n: number) => Object.fromEntries(q(n).map((x) => [x.fileId, { fileId: x.fileId, durationSec: 60, sizeBytes: 1, modifiedAt: 1 }]));
    expect(queueStats(q(3), entries(3)).totalLabel).toBe(moduleT("audio.label.minutesMin", { minutes: "3" }));
    expect(queueStats(q(61), entries(61)).totalLabel).toBe(moduleT("audio.label.hoursHMinutesMin", { hours: "1", minutes: "1" }));
    expectPolishForms((n) => moduleT("audio.description.countPluralOneTrackOtherTracksHasDurationSelectTrueDurationOther", { count: n, hasDuration: "false", duration: "" }));
  });

  it("the track sheet is Turkish on its own, bitrate and sample rate as strings", async () => {
    useMetadataStore.setState({
      entries: { a: { fileId: "a", title: "Song", artist: "Band", album: "LP", durationSec: 125, bitrateKbps: 319.6, sampleRateHz: 44100, sizeBytes: 5, modifiedAt: 1752000000, parsedAt: 1 } },
    });
    const r = await renderInLocale(<InfoSheet track={{ fileId: "a", title: "Song", artist: "Band", extension: "mp3", sizeBytes: 5, modifiedAt: 1752000000 }} visible onClose={jest.fn()} />, "tr");
    expect(r.leftover({ allow: ["Song", "Band", "LP", "MP3"] })).toEqual([]);
    expect(screen.getByText(moduleT("common.label.bitratekbpsKbps", { bitrateKbps: "320" }))).toBeTruthy();
    expect(screen.getByText(moduleT("common.label.sampleratekhzKHz", { sampleRateKhz: "44.1" }))).toBeTruthy();
  });

  it("toasts from the controller and the favourites hook read in the current language", async () => {
    await renderInLocale(<></>, "tr");
    await expect(playSingleFile({ id: "x", name: "a.bin", size_bytes: 1, mime_type: "application/octet-stream", extension: ".bin", lock_mode: "none" } as never, "Folder")).resolves.toBe(false);
    expect(toast).toHaveBeenCalledWith(moduleT("common.error.thisFileCanTBePlayed"));
    expect(moduleT("common.error.thisFileCanTBePlayed")).not.toBe("This file can't be played.");
    expect(moduleT("common.status.queueCappedAtQueueCapTracks", { queueCap: "500" })).toContain("500");
    expect(typeof playFolder).toBe("function");
  });
});

// ============================ the viewer ============================

describe("the viewer chrome, actions, details and sheet", () => {
  it("chrome is Turkish", async () => {
    const r = await renderInLocale(<ViewerChrome visible position="3 / 9" palette={palette} onBack={jest.fn()} onMore={jest.fn()} />, "tr");
    expect(r.leftover({ allow: ["3 / 9"] })).toEqual([]);
    expect(screen.getByLabelText(moduleT("common.back"))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("files.action.moreActions"))).toBeTruthy();
  });

  it("actions are Turkish (the download ring label is the files unit's)", async () => {
    const h = { onDownload: jest.fn(), onLink: jest.fn(), onStar: jest.fn(), onVersions: jest.fn(), onMore: jest.fn() };
    const all = { save: true, link: true, star: true, versions: true, more: true };
    const r = await renderInLocale(<ViewerActions availability={all} starred versionCount={3} handlers={h} />, "tr");
    // "Download" comes from src/files/downloadModel.ringLabel (unit B).
    expect(r.leftover({ allow: ["Download"] })).toEqual([]);
    expect(screen.getByText(moduleT("files.label.starred"))).toBeTruthy();
    expect(screen.getByText(moduleT("common.label.versions"))).toBeTruthy();
  });

  it("details are Turkish", async () => {
    const neighbours = [file({ id: "a" }), file({ id: "b" })];
    const Details = () => {
      useT();
      const rows = detailRows(file(), { regionLabel: "Frankfurt", formatWhen: () => "10 Tem 2025" });
      return <ViewerDetails rows={rows} neighbours={neighbours} currentId="a" onSelect={jest.fn()} />;
    };
    const r = await renderInLocale(<Details />, "tr");
    expect(r.leftover({ allow: ["Frankfurt", "Ayse", ".jpg", "10 Tem 2025"] })).toEqual([]);
    expect(screen.getByText(moduleT("files.heading.inThisFolder"))).toBeTruthy();
  });

  it("the sheet is Turkish: toggle label, badge, meta and primary action", async () => {
    const Sheet = () => {
      useT();
      const primary = primaryAction({ file: file({ extension: ".epub", mime_type: "application/epub+zip" }), stage: "book", readPercent: 0.4 });
      return (
        <ViewerSheet visible expanded={false} onToggleExpanded={jest.fn()} name="b.epub" meta={metaParts(file(), { pageCount: 3 })} badge={lockBadge(file({ lock_mode: "view_only" }), null)} primary={primary}>
          <Text>x</Text>
        </ViewerSheet>
      );
    };
    const r = await renderInLocale(<Sheet />, "tr");
    expect(r.leftover({ allow: ["b.epub", "x", "JPEG image"] })).toEqual([]);
    expect(screen.getByLabelText(moduleT("files.action.showDetails"))).toBeTruthy();
    expect(screen.getByText(moduleT("files.action.continueReading"))).toBeTruthy();
  });

  it("the sheet shows Cancel and Retry on a transfer in the language", async () => {
    const big = { fileId: "f1", name: "m.mp4", phase: "downloading" as const, written: 100 * 1048576, total: 512 * 1048576, startedAt: 0 };
    await renderInLocale(<ViewerSheet visible expanded={false} onToggleExpanded={jest.fn()} name="m" meta={["a"]} download={big} onCancelDownload={jest.fn()} now={1000}><Text>x</Text></ViewerSheet>, "tr");
    expect(screen.getByText(moduleT("common.cancel"))).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<ViewerSheet visible expanded={false} onToggleExpanded={jest.fn()} name="m" meta={["a"]} download={{ ...big, phase: "error" }} onCancelDownload={jest.fn()} now={1000}><Text>x</Text></ViewerSheet>, "tr");
    expect(screen.getByText(moduleT("common.retry"))).toBeTruthy();
  });

  it("the view model follows the language and its plurals work in Polish for 1, 3 and 5", async () => {
    await inPolish();
    expect(lockBadge(file({ lock_mode: "view_only" }), null)).toBe(moduleT("common.status.viewOnly"));
    expect(lockBadge(file({ lock_mode: "full_lock" }), null)).toBe(moduleT("files.status.locked"));
    expect(primaryAction({ file: file(), stage: "error" })?.label).toBe(moduleT("common.action.tryAgain"));
    expect(primaryAction({ file: file({ mime_type: "application/pdf", extension: ".pdf" }), stage: "pdf" })?.label).toBe(moduleT("files.action.read"));
    expect(primaryAction({ file: file({ mime_type: "audio/mpeg", extension: ".mp3" }), stage: "audio" })?.label).toBe(moduleT("common.accessibility.play"));
    expect(primaryAction({ file: file({ name: "a.zip", mime_type: "application/zip", extension: ".zip" }), stage: "none" })?.label).toBe(moduleT("files.action.browseContents"));
    expect(primaryAction({ file: file({ mime_type: "application/x-foo", extension: ".foo" }), stage: "none" })?.label).toBe(moduleT("common.action.saveToPhone"));
    expect(primaryAction({ file: file(), stage: "contacts" })?.label).toBe(moduleT("files.action.viewContacts"));
    expectPolishForms((n) => primaryAction({ file: file(), stage: "contacts", contactCount: n })!.label);
    expectPolishForms((n) => metaParts(file(), { pageCount: n }).find((p) => /\d/.test(p) && p.includes(String(n)) && p !== String(n) && !/MB|KB/.test(p) && !/\d{4}/.test(p))!);
    expectPolishForms((n) => metaParts(file(), { lineCount: n }).find((p) => p.includes(String(n)) && !/MB|KB/.test(p) && !/\d{4}/.test(p))!);
    expectPolishForms((n) => metaParts(file(), { contactCount: n }).find((p) => p.includes(String(n)) && !/MB|KB/.test(p) && !/\d{4}/.test(p))!);
    expect(metaParts(file(), { readPercent: 0.4 })).toContain(moduleT("files.label.percentRead", { percent: "40" }));
    const labels = detailRows(file(), { regionLabel: "x", formatWhen: () => "d" }).map((r) => r.label);
    expect(labels).toEqual([
      "files.label.kind", "common.label.size", "files.label.added", "common.label.modified", "files.label.addedBy",
      "files.label.storedIn", "files.label.versionTitleCase", "files.label.links", "files.label.extension",
    ].map((k) => moduleT(k as never)));
    expect(actionAvailability(file(), null).save).toBe(true);
  });

  it("the position counter reads in the language", async () => {
    await renderInLocale(<></>, "tr");
    expect(positionLabel({ files: [file(), file()], index: 1, sourceName: "x", paged: true } as never)).toBe(moduleT("common.label.sentOfTotal", { sent: "2", total: "2" }));
  });

  it("English metadata stays byte-identical", () => {
    expect(metaParts(file(), { pageCount: 1, lineCount: 2, contactCount: 1, readPercent: 0.4, dimensions: "10 x 20" }).slice(2, 7))
      .toEqual(["10 x 20", "1 page", "2 lines", "1 contact", "40% read"]);
    expect(detailRows(file(), { regionLabel: "r", formatWhen: () => "d" }).find((r) => r.label === "Links")?.value).toBe("2 active");
    expect(primaryAction({ file: file(), stage: "contacts", contactCount: 3 })?.label).toBe("View 3 contacts");
    expect(primaryAction({ file: file(), stage: "contacts", contactCount: 1 })?.label).toBe("View 1 contact");
    expect(primaryAction({ file: file(), stage: "contacts" })?.label).toBe("View contacts");
  });
});

describe("the viewer stages", () => {
  it("glyph stage: every variant is Turkish, and a size is carried by the select", async () => {
    for (const variant of ["none", "too-large", "error", "undecodable"] as const) {
      __resetI18nForTests();
      const r = await renderInLocale(<GlyphStage variant={variant} name="a.bin" mimeType="application/octet-stream" extension=".bin" sizeLabel="412 MB" palette={palette} />, "tr");
      expect(r.leftover({ allow: ["BIN", "412 MB"] })).toEqual([]);
    }
    __resetI18nForTests();
    await renderInLocale(<GlyphStage variant="too-large" name="a.log" mimeType="text/plain" extension=".log" palette={palette} />, "en");
    expect(screen.getByText("This file is too large to preview here. Save it to read the whole file.")).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<GlyphStage variant="too-large" name="a.log" mimeType="text/plain" extension=".log" sizeLabel="412 MB" palette={palette} />, "en");
    expect(screen.getByText("412 MB is too large to preview here. Save it to read the whole file.")).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<GlyphStage variant="none" name="a.zip" mimeType="application/zip" extension=".zip" palette={palette} />, "tr");
    expect(screen.getByText(moduleT("files.description.browseThisArchiveWithoutSavingIt"))).toBeTruthy();
  });

  it("lock gate is Turkish", async () => {
    const r = await renderInLocale(<LockGate busy={false} error={null} onSubmit={jest.fn()} palette={palette} />, "tr");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByPlaceholderText(moduleT("common.placeholder.password"))).toBeTruthy();
  });

  it("live photo badge, image dimensions, book, contacts are Turkish", async () => {
    const r = await renderInLocale(<LivePhotoStage uri="u" twinUri="v" palette={palette} />, "tr");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByText(moduleT("files.label.live"))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("common.accessibility.playLivePhoto"))).toBeTruthy();
    __resetI18nForTests();
    const onDimensions = jest.fn();
    await renderInLocale(<ImageStage uri="u" palette={palette} onDimensions={onDimensions} />, "tr");
    fireEvent(screen.getByTestId("image-stage"), "load", { source: { width: 4032, height: 3024 } });
    expect(onDimensions).toHaveBeenCalledWith(moduleT("common.label.wXH", { w: "4032", h: "3024" }));
    __resetI18nForTests();
    const b = await renderInLocale(<BookStage fileId="b1" name="Moby.epub" percent={0} palette={palette} />, "tr");
    expect(b.leftover({ allow: ["Moby"] })).toEqual([]);
    expect(screen.getByText(moduleT("files.status.notStarted"))).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<BookStage fileId="b1" name="Moby.epub" percent={0.42} palette={palette} />, "tr");
    expect(screen.getByText(moduleT("files.label.percentRead", { percent: "42" }))).toBeTruthy();
    __resetI18nForTests();
    const c = await renderInLocale(<ContactsStage cards={parseVCardFile(["Ada Lovelace", "Bob Ross"].map((n) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${n}\r\nEND:VCARD\r\n`).join("")).cards} total={9} />, "tr");
    expect(c.leftover({ allow: ["AL", "Ada Lovelace", "BR", "Bob Ross"] })).toEqual([]);
    expect(screen.getByTestId("contact-peek-rest")).toBeTruthy();
    expect(screen.getByText(moduleT("files.label.andRestMore", { rest: "7" }))).toBeTruthy();
  });

  it("csv, markdown, text and pdf stages are Turkish", async () => {
    const csv = Array.from({ length: 5 }, (_, i) => `a${i},b${i}`).join("\n");
    const r = await renderInLocale(<CsvStage text={`h1,h2\n${csv}`} mimeType="text/csv" extension=".csv" mutedColor="#888" />, "tr");
    expect(r.leftover({ allow: ["h1", "h2"] })).toEqual([]);
    __resetI18nForTests();
    const m = await renderInLocale(<MarkdownStage text={"# Title\n\ntext"} mutedColor="#888" />, "tr");
    expect(m.leftover({ allow: ["Title", "text", "Markdown"] })).toEqual([]);
    expect(screen.getByText(moduleT("files.label.linecountLines", { lineCount: "3" }))).toBeTruthy();
    __resetI18nForTests();
    const tx = await renderInLocale(<TextStage text={"one\ntwo"} mimeType="text/plain" extension=".txt" mutedColor="#888" />, "tr");
    expect(tx.leftover({ allow: ["one", "two"] })).toEqual([]);
    fireEvent.press(screen.getByTestId("text-stage-copy"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(moduleT("files.status.copiedToClipboard")));
    __resetI18nForTests();
    const p = await renderInLocale(<PdfStage uri="u" palette={palette} />, "tr");
    const Pdf = require("react-native-pdf");
    await act(async () => { Pdf.getLastProps().onLoadComplete(7); });
    expect(p.leftover()).toEqual([]);
    expect(screen.getByText(moduleT("common.label.pagePageOfPageCount", { page: "1", pageCount: "7" }))).toBeTruthy();
  });

  it("csv, text and markdown counts: Polish plurals for 1, 3 and 5", async () => {
    await inPolish();
    expectPolishForms((n) => moduleT("files.label.totalrowsPluralOneRowOtherRowsXColumnsCols", { totalRows: n, columns: "2" }).replace(/ x \d+ .*/, ""));
    expectPolishForms((n) => moduleT("files.description.truncatedrowsMoreTruncatedRowsPluralOneRowOtherRowsSaveTheFileForAllOf", { truncatedRows: n }).replace(/ - .*/, ""));
    expectPolishForms((n) => moduleT("files.label.renderlinescountPluralOneLineOtherLines", { renderLinesCount: n }));
  });

  it("English texts of the stages are unchanged", async () => {
    await renderInLocale(<CsvStage text={"h1,h2\na,b"} mimeType="text/csv" extension=".csv" mutedColor="#888" />, "en");
    expect(screen.getByText("1 row x 2 cols")).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<TextStage text={"one\ntwo"} mimeType="text/plain" extension=".txt" mutedColor="#888" />, "en");
    expect(screen.getByText("2 lines")).toBeTruthy();
    expect(screen.getByLabelText("Wrap long lines")).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<LivePhotoStage uri="u" twinUri="v" palette={palette} />, "en");
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("video stages: unplayable, stalled, failed and the VLC transport are Turkish", async () => {
    jest.useFakeTimers();
    (Platform as unknown as { OS: string }).OS = "ios";
    mockVlcAvailable = false;
    try {
      const v = await renderInLocale(<VideoStage uri="https://r/x" mimeType="video/x-matroska" extension=".mkv" onSave={jest.fn()} onRetry={jest.fn()} />, "tr");
      expect(v.leftover({ allow: ["Matroska"] })).toEqual([]);
      expect(screen.getByText(moduleT("common.heading.thisPhoneCanTPlayFormatVideo", { platform: "ios", format: "Matroska" }))).toBeTruthy();
      __resetI18nForTests();
      await renderInLocale(<VideoStage uri="https://r/x" mimeType="video/mp4" extension=".mp4" onSave={jest.fn()} onRetry={jest.fn()} />, "tr");
      act(() => { jest.advanceTimersByTime(16_000); });
      expect(screen.getByText(moduleT("common.heading.stillLoading"))).toBeTruthy();
      expect(screen.getByText(moduleT("common.description.fifteenSecondsWithoutAFirstFrameEitherTheConnectionIsPoorOrThisPhone"))).toBeTruthy();
      expect(collectTexts()).toEqual(expect.arrayContaining([moduleT("common.retry"), moduleT("common.action.saveToDevice")]));
      __resetI18nForTests();
      mockVlcAvailable = true;
      const vl = await renderInLocale(<VlcVideoStage uri="u" onSave={jest.fn()} onRetry={jest.fn()} />, "tr");
      act(() => mockNativeProps.onLoaded?.({ nativeEvent: { duration: 100 } }));
      expect(vl.leftover()).toEqual([]);
      expect(screen.getByLabelText(moduleT("common.accessibility.pause"))).toBeTruthy();
      act(() => mockNativeProps.onEnd?.());
      expect(screen.getByLabelText(moduleT("common.action.replay"))).toBeTruthy();
      __resetI18nForTests();
      await renderInLocale(<VlcVideoStage uri="u" onSave={jest.fn()} onRetry={jest.fn()} />, "tr");
      act(() => { jest.advanceTimersByTime(16_000); });
      expect(screen.getByText(moduleT("common.description.fifteenSecondsWithoutAFirstFrameEitherTheConnectionIsPoorOrThisFile"))).toBeTruthy();
      act(() => mockNativeProps.onError?.({}));
      expect(screen.getByText(moduleT("common.error.couldnTPlayThisVideo"))).toBeTruthy();
      expect(screen.getByText(moduleT("common.description.theStreamStoppedOrThisFileSCodecDefeatedTheBuiltInPlayerRetry"))).toBeTruthy();
      __resetI18nForTests();
      await renderInLocale(<VlcInlineAudioPlayer uri="u" />, "tr");
      expect(screen.getByLabelText(moduleT("common.accessibility.play"))).toBeTruthy();
      act(() => mockNativeProps.onError?.({}));
      expect(screen.getByText(moduleT("files.error.couldnTPlayThisFileSaveItAndOpenItInAnotherApp"))).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("office stage and the format names are Turkish", async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({ status: 415, json: async () => ({}) }));
    const r = await renderInLocale(<OfficeStage uri="https://api.test/api/files/f1/preview-pdf" palette={palette} />, "tr");
    await waitFor(() => expect(screen.getByTestId("office-unsupported")).toBeTruthy());
    expect(r.leftover()).toEqual([]);
    expect(screen.getByText(moduleT("common.error.thisFileTypeCannotBePreviewedDownloadItInstead"))).toBeTruthy();
    expect(nextPreviewState({ kind: "preparing", attempt: 0 }, { status: 500 })).toEqual({ kind: "failed", message: moduleT("common.error.couldNotPrepareAPreviewForThisFile") });
    expect(nextPreviewState({ kind: "preparing", attempt: 19 }, { status: 503 })).toEqual({ kind: "failed", message: moduleT("common.error.thisPreviewIsTakingTooLongDownloadTheFile") });
    expect(containerLabel("video/mp2t", ".ts")).toBe(moduleT("common.label.mpegTransportStream"));
    expect(containerLabel("video/x-matroska", ".mkv")).toBe("Matroska");
  });
});

// ============================ the reader ============================

describe("the book reader", () => {
  const book = { id: "f1", name: "moby.epub", size_bytes: 1000 };
  beforeEach(() => { mockInjected.length = 0; });

  it("preparing overlay and error overlay are Turkish", async () => {
    const r = await renderInLocale(<BookReader file={book} localUri="u" format="book" onClose={jest.fn()} onOpenDetails={jest.fn()} />, "tr");
    expect(r.leftover({ allow: ["moby.epub"] })).toEqual([]);
    expect(screen.getByTestId("reader-stage-label").props.children).toBe(moduleT("reader.label.preparingBook"));
    await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "stage", stage: "parsing" })); });
    expect(screen.getByTestId("reader-stage-label").props.children).toBe(moduleT("reader.label.readingBook"));
    await act(async () => { (mockWebviewProps.onRenderProcessGone as () => void)(); });
    expect(r.leftover({ allow: ["moby.epub"] })).toEqual([]);
    expect(screen.getByText(moduleT("reader.error.thisBookDidnTOpen"))).toBeTruthy();
    expect(screen.getByText(moduleT("reader.error.itNeededMoreMemoryThanThisPhoneCouldSpareTryingAgainOftenWorks"))).toBeTruthy();
  });

  it("hands the page its own texts in the language", async () => {
    await renderInLocale(<BookReader file={book} localUri="u" format="book" onClose={jest.fn()} />, "tr");
    await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });
    await waitFor(() => expect(mockInjected.some((js) => js.includes("searchBookLoading"))).toBe(true));
    const init = mockInjected.find((js) => js.includes("searchBookLoading"))!;
    expect(init).toContain(JSON.stringify(moduleT("reader.description.theBookIsStillLoadingTrySearchingAgainInAMoment")).slice(1, -1));
    expect(jsInit({ name: "a", format: "book", fontSizePct: 100, bg: "#fff", fg: "#000", location: null })).not.toContain("searchBookLoading");
  });

  it("menu, contents, themes and search sheets are Turkish", async () => {
    const r = await renderInLocale(<ReaderMenu visible percent={42} canSearch canTheme bookmarked={false} onClose={jest.fn()} onContents={jest.fn()} onSearch={jest.fn()} onThemes={jest.fn()} onShare={jest.fn()} onToggleBookmark={jest.fn()} />, "tr");
    expect(r.leftover({ allow: ["42%"] })).toEqual([]);
    __resetI18nForTests();
    const c = await renderInLocale(<ReaderChrome visible onClose={jest.fn()} onOpenMenu={jest.fn()} />, "tr");
    expect(c.leftover()).toEqual([]);
    __resetI18nForTests();
    const toc = await renderInLocale(
      <TocSheet visible toc={[{ label: "Ch 1", href: "1", depth: 0 }]} bookmarks={[{ id: "b1", location: "page:2", label: "Page 2", createdAt: "2025-07-10T10:00:00Z" }]} onClose={jest.fn()} onBack={jest.fn()} onSelectToc={jest.fn()} onSelectBookmark={jest.fn()} onRemoveBookmark={jest.fn()} />,
      "tr",
    );
    expect(toc.leftover({ allow: ["Ch 1"] })).toEqual([]);
    fireEvent.press(screen.getByTestId("toc-tab-bookmarks"));
    expect(toc.leftover({ allow: ["Page 2"] })).toEqual([]);
    expect(screen.getByLabelText(moduleT("common.tooltip.removeBookmark"))).toBeTruthy();
    __resetI18nForTests();
    const th = await renderInLocale(<ThemesSheet visible onClose={jest.fn()} onBack={jest.fn()} />, "tr");
    expect(th.leftover({ allow: ["Aa", "A"] })).toEqual([]);
    expect(APP_READER_THEMES).toHaveLength(8);
    for (const theme of APP_READER_THEMES) {
      expect(theme.label).toBe(moduleT(THEME_LABEL_KEYS[theme.id as keyof typeof THEME_LABEL_KEYS]));
      expect(screen.getByLabelText(moduleT("reader.label.labelTheme", { label: theme.label }))).toBeTruthy();
    }
    expect(APP_READER_THEMES.find((x) => x.id === "ocean")!.label).not.toBe("Ocean");
    expect(READING_THEMES.map((x) => x.label)).toEqual([moduleT("common.option.light"), moduleT("reader.label.sepia"), moduleT("common.option.dark")]);
    expect(screen.getByLabelText(moduleT("reader.label.labelTheme", { label: moduleT("reader.label.sepia") }))).toBeTruthy();
    expect(APP_READER_THEMES.length).toBeGreaterThan(0);
    __resetI18nForTests();
    const s = await renderInLocale(<SearchSheet visible hits={[]} searching={false} error={null} onQuery={jest.fn()} onSelect={jest.fn()} onClose={jest.fn()} onBack={jest.fn()} />, "tr");
    expect(s.leftover()).toEqual([]);
    fireEvent.changeText(screen.getByTestId("search-input"), "zz");
    await waitFor(() => expect(screen.getByText(moduleT("reader.description.noResultsForTrimmed", { trimmed: "zz" }))).toBeTruthy());
  });

  it("the stage labels, error copy and PDF outline fallback follow the language", async () => {
    await renderInLocale(<></>, "tr");
    expect(stageLabel("assembling")).toBe(moduleT("reader.label.assemblingBook"));
    expect(stageLabel("rendering")).toBe(moduleT("reader.label.layingOutPages"));
    expect(stageLabel("locating")).toBe(moduleT("reader.label.findingYourPlace"));
    expect(stageLabel("receiving")).toBe(moduleT("reader.label.transferringBook"));
    expect(errorCopy("unknown")).toBe(moduleT("reader.error.somethingWentWrongWhileOpeningIt"));
    expect(flattenPdfOutline([{ pageIdx: 0 }])[0].label).toBe(moduleT("reader.label.untitled"));
  });

  it("English: searching ellipsis and the download error wording", async () => {
    await renderInLocale(<SearchSheet visible hits={[]} searching error={null} onQuery={jest.fn()} onSelect={jest.fn()} onClose={jest.fn()} onBack={jest.fn()} />, "en");
    fireEvent.changeText(screen.getByTestId("search-input"), "moby");
    await waitFor(() => expect(screen.getByText("Searching…")).toBeTruthy());
    expect(stageLabel(null)).toBe("Preparing book…");
    // A restricted book is downloaded by holdOpen; its two failures speak the language.
    const restricted = { id: "f1", current_version: 1, extension: "epub", name: "b.epub", size_bytes: 10, lock_mode: "view_only" };
    mockDownloadAsync.mockResolvedValue({ status: 403, uri: "file:///x" });
    await expect(ensureBookCached(restricted, async () => "https://r2/x")).rejects.toMatchObject({ message: "Download failed: 403", status: 403 });
    mockDownloadAsync.mockResolvedValue(undefined);
    await expect(ensureBookCached(restricted, async () => "https://r2/x")).rejects.toMatchObject({ message: "Download did not complete" });
    __resetI18nForTests();
    await renderInLocale(<></>, "tr");
    await expect(ensureBookCached(restricted, async () => "https://r2/x")).rejects.toMatchObject({ message: moduleT("common.error.downloadDidNotComplete") });
  });

  it("the PDF reader error and bookmarks are Turkish", async () => {
    const Pdf = require("react-native-pdf");
    const r = await renderInLocale(<PdfReader file={{ id: "f1", name: "scan.pdf" }} localUri="u" onClose={jest.fn()} onOpenDetails={jest.fn()} />, "tr");
    await waitFor(() => expect(Pdf.getLastProps()).toBeTruthy());
    await act(async () => { Pdf.getLastProps().onError(); });
    expect(r.leftover()).toEqual([]);
    expect(screen.getByText(moduleT("reader.error.couldnTOpenThisBook"))).toBeTruthy();
    expect(screen.getByText(moduleT("common.close"))).toBeTruthy();
    expect(screen.getByText(moduleT("reader.action.openFileDetails"))).toBeTruthy();
  });

  it("switching language while a reader sheet is open changes it in place", async () => {
    let api!: ReturnType<typeof useLocale>;
    const Probe = () => { api = useLocale(); return null; };
    await renderInLocale(<><ThemesSheet visible onClose={jest.fn()} onBack={jest.fn()} /><Probe /></>, "en");
    expect(screen.getByText("Text size")).toBeTruthy();
    await act(async () => { await api.setPreference("de"); });
    expect(screen.queryByText("Text size")).toBeNull();
    expect(screen.getByText((await loadMessages("de"))["reader.label.textSize"])).toBeTruthy();
    expect(READING_THEMES[0].label).toBe((await loadMessages("de"))["common.option.light"]);
  });
});

// ============================ orbit ============================

describe("the orbit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadStore.getState().clearAll();
    useUploadStore.setState({ items: [] });
    usePlayerStore.setState({ queue: [], index: -1, playing: false });
    useMetadataStore.setState({ entries: {} });
    useUploadTarget.setState({ workspaceId: "w1", folderId: null, folderName: null, workspaceName: "Workspace 1", canAdd: true });
    setVaultActivity(NO_VAULT_ACTIVITY);
  });

  it("the sheet with transfers, a track, the vault and sources is Turkish", async () => {
    useDownloadStore.setState({ entries: { d1: { fileId: "d1", name: "match.mp4", phase: "downloading", written: 43, total: 100, startedAt: 0 } } } as never);
    useUploadStore.setState({
      items: [
        { id: "u1", name: "photo.jpg", uri: "f", size: 100, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
        { id: "u2", name: "bad.jpg", uri: "f", size: 100, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: "Server said no" },
        { id: "u3", name: "wait.jpg", uri: "f", size: 100, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 },
      ],
    });
    usePlayerStore.setState({ queue: [track("t1", "Ocean Eyes")], index: 0, playing: true });
    setVaultActivity({ count: 2, failed: 1, uploads: 2, downloads: 0, written: 10, total: 100 });
    const r = await renderInLocale(<OrbitSheet visible onClose={jest.fn()} />, "tr");
    // Download captions come from files/downloadModel.progressCaption (unit B).
    const stray = r.leftover({ allow: ["match.mp4", "photo.jpg", "bad.jpg", "wait.jpg", "Server said no", "Ocean Eyes", "Road trip", "Workspace 1"] });
    // The matcher also reads "Workspace 1 konumuna ekle" as English (the workspace name is data).
    expect(stray.filter((s) => !/B\/s/.test(s) && s !== "Workspace 1 konumuna ekle")).toEqual([]);
    expect(screen.getByLabelText(moduleT("navigation.label.cancelName", { name: "match.mp4" }))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("navigation.label.retryName", { name: "bad.jpg" }))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("navigation.action.openPlayer"))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("navigation.action.stopPlayback"))).toBeTruthy();
    expect(screen.getByText(moduleT("navigation.label.waitingToUpload"))).toBeTruthy();
    expect(screen.getByText(moduleT("navigation.label.uploadingPercent", { percent: "50" }))).toBeTruthy();
    expect(screen.getByText(moduleT("navigation.label.addToTargetLabel", { targetLabel: "Workspace 1" }))).toBeTruthy();
  });

  it("the empty read-only sheet is Turkish", async () => {
    useUploadTarget.setState({ canAdd: false, canCreateFolder: false });
    const r = await renderInLocale(<OrbitSheet visible onClose={jest.fn()} />, "tr");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByText(moduleT("navigation.description.youHaveReadOnlyAccessToThisWorkspace"))).toBeTruthy();
  });

  it("the picker failure toast is Turkish", async () => {
    (startFromPicker as jest.Mock).mockRejectedValueOnce(new Error("Different document picking in progress"));
    await renderInLocale(<OrbitSheet visible onClose={jest.fn()} />, "tr");
    fireEvent.press(screen.getByTestId("orbit-source-files"));
    finishSheetDismissal();
    await act(async () => {});
    expect(toast).toHaveBeenCalledWith(moduleT("common.error.couldnTOpenThePicker"), "error");
    expect(moduleT("common.error.couldnTOpenThePicker")).not.toBe("Couldn't open the picker.");
  });

  it("the button label follows the language and the upload target names are translated", async () => {
    usePlayerStore.setState({ queue: [track("t1", "x")], index: 0, playing: true });
    setVaultActivity({ count: 2, failed: 1, uploads: 2, downloads: 0, written: 10, total: 100 });
    await renderInLocale(<OrbitButton open={false} onPress={jest.fn()} progress={{ position: 0, duration: 0 }} />, "tr");
    expect(screen.getByTestId("orbit-button").props.accessibilityLabel).toBe(
      moduleT("navigation.error.nowPlayingCountPluralOneTransferOtherTransfersHasFailuresSelectTrueFailedFailedOther", { count: 2, hasFailures: "true", failed: "1" }),
    );
    expect(targetLabel({ workspaceId: null, folderId: null, folderName: null, workspaceName: null, canAdd: false, canCreateFolder: false })).toBe(moduleT("common.label.noWorkspace"));
    expect(targetLabel({ workspaceId: "w", folderId: null, folderName: null, workspaceName: null, canAdd: true, canCreateFolder: false })).toBe(moduleT("common.label.workspaceRoot"));
  });

  it("switches language in place", async () => {
    let api!: ReturnType<typeof useLocale>;
    const Probe = () => { api = useLocale(); return null; };
    usePlayerStore.setState({ queue: [track("t1", "x")], index: 0, playing: true });
    await renderInLocale(<><OrbitButton open={false} onPress={jest.fn()} progress={{ position: 0, duration: 0 }} /><Probe /></>, "en");
    expect(screen.getByTestId("orbit-button").props.accessibilityLabel).toBe("Now playing");
    await act(async () => { await api.setPreference("de"); });
    expect(screen.getByTestId("orbit-button").props.accessibilityLabel).toBe((await loadMessages("de"))["navigation.label.nowPlaying"]);
  });

  it("orbit counts: Polish plurals for 1, 3 and 5", async () => {
    await inPolish();
    const vault = (n: number) => ({ count: n, failed: 0, uploads: n, downloads: 0, written: 0, total: 100 });
    expectPolishForms((n) => vaultSummary(vault(n))!.title);
    expectPolishForms((n) => vaultSummary({ ...vault(n), failed: n })!.caption);
    expectPolishForms((n) => orbitState({ downloads: [], uploads: [], hasTrack: false, position: 0, duration: 0, vault: vault(n), open: false }).label);
    expectPolishForms((n) => orbitState({ downloads: [], uploads: [], hasTrack: true, position: 0, duration: 0, vault: { ...vault(n), failed: 1 }, open: false }).label);
    // The heading carries no number: Polish gives it one form for 1 and one for 3 and 5.
    expect(moduleT("navigation.heading.countPluralOneTransferOtherTransfers", { count: 1 })).toBe("Transfer");
    expect(moduleT("navigation.heading.countPluralOneTransferOtherTransfers", { count: 3 })).toBe("Transfery");
    expect(moduleT("navigation.heading.countPluralOneTransferOtherTransfers", { count: 5 })).toBe("Transfery");
    expectPolishForms((n) => orbitState({ downloads: [], uploads: [], hasTrack: false, position: 0, duration: 0, vault: { ...vault(n), failed: 1 }, open: false }).label);
  });

  it("English orbit text is unchanged", () => {
    const v = { count: 2, failed: 1, uploads: 2, downloads: 0, written: 10, total: 100 };
    expect(vaultSummary(v)).toEqual({ title: "2 files in your Vault", caption: "1 file couldn't upload" });
    expect(vaultSummary({ ...v, count: 1, failed: 0, downloads: 1, uploads: 0 })).toEqual({ title: "1 file in your Vault", caption: "Downloading and decrypting · 10%" });
    expect(vaultSummary({ ...v, failed: 0 })?.caption).toBe("Encrypting and uploading · 10%");
    expect(vaultSummary({ ...v, failed: 0, downloads: 1 })?.caption).toBe("Transferring · 10%");
    expect(vaultSummary({ ...v, failed: 2, downloads: 1 })?.caption).toBe("2 files couldn't finish");
    const label = (over: object) => orbitState({ downloads: [], uploads: [], hasTrack: false, position: 0, duration: 0, vault: NO_VAULT_ACTIVITY, open: false, ...over }).label;
    expect(label({})).toBe("Upload");
    expect(label({ open: true })).toBe("Close");
    expect(label({ hasTrack: true })).toBe("Now playing");
    expect(label({ vault: v })).toBe("2 transfers, 1 failed");
    expect(label({ vault: { ...v, count: 1, failed: 0 } })).toBe("1 transfer");
    expect(label({ hasTrack: true, vault: v })).toBe("Now playing, 2 transfers, 1 failed");
  });
});

// ============================ CarPlay ============================

describe("CarPlay", () => {
  const mockedCarplay = carplay as unknown as { __connect: () => Promise<void>; __disconnect?: () => void; __reset: () => void; __currentRoot: () => { config: { sections: { items: { text: string; detailText?: string }[] }[] } } };
  const rows = () => mockedCarplay.__currentRoot().config.sections.flatMap((s) => s.items);

  beforeEach(() => {
    mockedCarplay.__reset();
    jest.clearAllMocks();
    (bootstrap.hydrateForCarPlay as jest.Mock).mockResolvedValue("signed-in");
    (recents.getCurrentPlayback as jest.Mock).mockResolvedValue({ workspaceId: "ws1", fileId: "c1", title: "Current", sourceName: "S", positionSeconds: 3 });
    (recents.getRecent as jest.Mock).mockResolvedValue([]);
    (browse.listBrowseLevel as jest.Mock).mockResolvedValue({ folders: [], audioFiles: [] });
    useWorkspaceStore.setState({ activeId: "ws1", hydrated: true } as never);
    (Platform as unknown as { OS: string }).OS = "ios";
  });

  async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

  it("root rows are Turkish, and rebuild when the language changes while connected", async () => {
    let api!: ReturnType<typeof useLocale>;
    const Probe = () => { api = useLocale(); return null; };
    await renderInLocale(<Probe />, "tr");
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();
    expect(rows()[0].detailText).toBe(moduleT("carplay.label.continueListening"));
    await act(async () => { await api.setPreference("de"); });
    await settle();
    expect(rows()[0].detailText).toBe((await loadMessages("de"))["carplay.label.continueListening"]);
  });

  it("signed-out and error rows are Turkish", async () => {
    (bootstrap.hydrateForCarPlay as jest.Mock).mockResolvedValue("signed-out");
    await renderInLocale(<></>, "tr");
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();
    expect(rows()[0].text).toBe(moduleT("carplay.action.openDosyaOnYourIPhoneToSignIn"));
    __resetI18nForTests();
    mockedCarplay.__reset();
    (bootstrap.hydrateForCarPlay as jest.Mock).mockResolvedValue("signed-in");
    (browse.listBrowseLevel as jest.Mock).mockRejectedValue(new ApiError("Unauthorized", 401));
    await renderInLocale(<></>, "tr");
    installCarPlayBrowseScreen();
    await mockedCarplay.__connect();
    await settle();
    expect(rows().map((r) => r.text)).toContain(moduleT("carplay.description.reconnectOnYourIPhoneToKeepBrowsing"));
    expect(moduleT("carplay.error.couldnTLoadYourFilesCheckYourConnection")).not.toBe("Couldn't load your files. Check your connection.");
    expect(moduleT("carplay.error.tooManyNestedFoldersBrowseThisOnYourIPhone")).not.toBe("Too many nested folders - browse this on your iPhone");
  });

  it("voice search names its queue in the language", async () => {
    await renderInLocale(<></>, "tr");
    (search.searchAudio as jest.Mock).mockResolvedValue({ files: [file({ id: "v1" })], folders: [] });
    const ctrl = jest.requireMock("@/player/controller");
    const spy = jest.spyOn(ctrl, "playFileQueue").mockResolvedValue(true);
    await resolveVoiceQuery("ws1", "x");
    expect(spy).toHaveBeenCalledWith(expect.anything(), "v1", moduleT("carplay.label.searchResults"));
  });
});

// a tiny guard so a stray `render` import does not go unused in strict lint setups
void render;
void I18nProvider;
