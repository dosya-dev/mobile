/**
 * Unit C (library, duplicates, upload, map and Vault) in the chosen language.
 *
 * Each screen renders under I18nProvider in Turkish and nothing the catalog
 * knows may stay English; a language switch while mounted changes the text in
 * place; every plural the unit wires reads right in Polish for 1, 3 and 5;
 * every toast / dialog the unit converts is checked; the one approved
 * rewording has its new English asserted.
 */
import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { collectTexts, leftoverEnglish, renderInLocale } from "../../../test-utils/i18n-sweep";
import { __resetI18nForTests, t as moduleT, useLocale } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";

// ---- mocks (names start with "mock" so babel-plugin-jest-hoist allows them) ----
const mockKeychain = new Map<string, string>();
jest.mock("@/lib/keychain", () => ({
  getItem: async (k: string) => mockKeychain.get(k) ?? null,
  setItem: async (k: string, v: string) => { mockKeychain.set(k, v); },
  deleteItem: async (k: string) => { mockKeychain.delete(k); },
}));
jest.mock("@/vault/engine", () => ({ createVaultEngine: () => ({}) }));
jest.mock("@/vault/cache", () => ({
  cachePathFor: (_ws: string, _id: string, _v: number, name: string) => ({ dir: "/cache", fileName: name }),
  cachedFile: async () => null,
  createCacheSink: (t: { dir: string; fileName: string }) => ({ sink: async () => {}, finish: async () => `${t.dir}/${t.fileName}`, abort: async () => {} }),
  wipeVaultCache: async () => {},
}));
jest.mock("@/vault/fileSource", () => ({ fileSourceFromUri: async () => ({ totalSize: 4, boundaries: [{ offset: 0, size: 4 }], read: async () => new Uint8Array(4), close: () => {} }) }));

const mockParams: Record<string, string | undefined> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
// A function declaration is hoisted, so the factory can call it lazily.
function mockRouterModule(): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require("react");
  const { Text, View } = require("react-native");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const Screen = ({ options }: { options?: { title?: string; headerRight?: () => unknown } }) =>
    React.createElement(
      View,
      null,
      options?.title ? React.createElement(Text, { testID: "screen-title" }, options.title) : null,
      options?.headerRight ? options.headerRight() : null,
    );
  return {
    useLocalSearchParams: () => mockParams,
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void | (() => void)) => { React.useEffect(cb, [cb]); },
    Stack: { Screen },
  };
}
jest.mock("expo-router", () => mockRouterModule());

jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/files/saveToDevice", () => ({
  saveToDevice: jest.fn(async () => ({ kind: "gallery" })),
  saveOutcomeMessage: () => "saved",
  SaveCancelled: class SaveCancelled extends Error {},
}));
jest.mock("@/files/download", () => ({ shareFile: jest.fn(async () => {}) }));
jest.mock("@/viewer/stages/VideoStage", () => ({ VideoStage: () => null }));
jest.mock("@/viewer/stages/ImageStage", () => ({ ImageStage: () => null }));
const mockPickPhotos = jest.fn();
jest.mock("@/upload/pickers", () => ({ pickPhotos: () => mockPickPhotos(), pickDocuments: () => mockPickPhotos(), noteUploadIds: () => {} }));
jest.mock("expo-file-system", () => ({ File: class { delete() {} } }));

jest.mock("@/duplicates/api", () => ({ getDuplicates: jest.fn(), deleteDuplicates: jest.fn() }));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));
jest.mock("@/map/api", () => ({ getMapPins: jest.fn(), hasBasemap: jest.fn() }));
jest.mock("@/map/mapHtml.generated", () => ({ MAP_HTML: "<html></html>" }));
jest.mock("react-native-webview", () => {
  const React = require("react");
  const WebView = React.forwardRef((_p: unknown, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: () => {} }));
    return null;
  });
  WebView.displayName = "WebView";
  return { WebView, default: WebView };
});
jest.mock("@/library/hooks", () => ({ useLibrary: jest.fn() }));
jest.mock("@/files/FileThumb", () => ({ FileThumb: () => null }));
jest.mock("@/files/FileRow", () => ({ FileRow: () => null }));
jest.mock("@/files/FileCard", () => ({ FileCard: () => null }));
jest.mock("@/viewer/viewerStore", () => ({ useViewerList: (sel: (s: { setViewerList: () => void }) => unknown) => sel({ setViewerList: () => {} }) }));

const mockDisk = new Map<string, string>();
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  readAsStringAsync: jest.fn(async (p: string) => { if (!mockDisk.has(p)) throw new Error("ENOENT"); return mockDisk.get(p)!; }),
  writeAsStringAsync: jest.fn(async (p: string, v: string) => { mockDisk.set(p, v); }),
  deleteAsync: jest.fn(async (p: string) => { mockDisk.delete(p); }),
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  uploadAsync: jest.fn(async () => ({ status: 503, body: "" })),
}));
jest.mock("@/api", () => ({ ...jest.requireActual("@/api"), apiRequest: jest.fn() }));
jest.mock("@/auth/authStore", () => ({ ...jest.requireActual("@/auth/authStore"), getAccessToken: () => "tok" }));
const mockStartUploads = jest.fn();
jest.mock("@/upload/controller", () => {
  const actual = jest.requireActual("@/upload/controller");
  return { ...actual, startUploads: () => mockStartUploads() };
});

import DuplicatesScreen from "../../../app/duplicates";
import MapScreen from "../../../app/map";
import VaultScreen from "../../../app/(tabs)/vault/index";
import VaultFileScreen from "../../../app/(tabs)/vault/file";
import VaultSpaceFolderScreen from "../../../app/(tabs)/vault/space/[id]/[folderId]";
import { LibraryBrowser } from "@/library/LibraryBrowser";
import { useLibrary } from "@/library/hooks";
import type { LibraryItem, LibraryKind, LibraryPage } from "@/library/api";
import { plural } from "@/library/api";
import { getDuplicates, deleteDuplicates } from "@/duplicates/api";
import { getMapPins, hasBasemap } from "@/map/api";
import { useVault, type KnownSpace } from "@/vault/store";
import type { VaultEngine, VaultEntry } from "@/vault/engine";
import { PassphraseStep } from "@/vault/ui/onboarding/PassphraseStep";
import { UnlockCard } from "@/vault/ui/UnlockCard";
import { SpaceRow } from "@/vault/ui/SpaceRow";
import { TransferBar } from "@/vault/ui/TransferBar";
import { VaultEntryRow } from "@/vault/ui/VaultEntryRow";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useAuthStore } from "@/auth/authStore";
import { toast } from "@/ui/toast";
import { formatBytes } from "@/files/format";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { useUploadStore } from "@/upload/store";
import { hydrateUploadQueue, UPLOAD_QUEUE_FILE, __resetUploadQueuePersistence } from "@/upload/persist";
import { startFromPicker } from "@/upload/startFromPicker";
import { classifyUploadError } from "@/upload/controller";
import { uploadResumable } from "@/upload/resumable";
import { apiRequest } from "@/api";
import * as FileSystem from "expo-file-system/legacy";
import { itemErrorText } from "@/upload/uploadError";
jest.mock("@/upload/limits", () => ({
  fetchUploadLimits: jest.fn(async () => ({})),
  screenDrafts: jest.fn((drafts: unknown[]) => ({ accepted: drafts, rejected: [], quotaOver: 1 })),
  summariseRejections: jest.fn(() => "x"),
}));
jest.mock("@/backup/livePhoto", () => ({ discardLivePhotoTemp: jest.fn(async () => {}) }));

const mockGetDuplicates = getDuplicates as jest.MockedFunction<typeof getDuplicates>;
const mockDeleteDuplicates = deleteDuplicates as jest.MockedFunction<typeof deleteDuplicates>;
const mockPins = getMapPins as jest.MockedFunction<typeof getMapPins>;
const mockBasemap = hasBasemap as jest.MockedFunction<typeof hasBasemap>;
const mockToast = toast as jest.MockedFunction<typeof toast>;

// Dialog buttons and the password eye belong to src/ui (unit K) and stay English until it lands.
// User data from the fixtures below.
const DATA = ["photo.jpg", "Holiday trip", "Trip", "Folder 0", "Folder 1", "a.png", "b.png", "a1", "report.pdf", "July 2024", "June 2024"];

afterEach(() => {
  __resetI18nForTests();
});

const leftover = (locale: Locale, allow: string[] = []) => leftoverEnglish(collectTexts(), locale, { allow: [...DATA, ...allow] });

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

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

/** Switches the language of whatever is mounted next to this probe. */
function switcher(): { setTo: (l: Locale) => Promise<void>; Probe: () => null } {
  let api!: ReturnType<typeof useLocale>;
  const Probe = () => { api = useLocale(); return null; };
  return { setTo: async (l) => { await act(async () => { await api.setPreference(l); }); }, Probe };
}

// ============================ duplicates ============================

function group(hash: string, size: number, ids: string[]) {
  return {
    content_hash: hash, size_bytes: size, count: ids.length, wasted_bytes: (ids.length - 1) * size,
    files: ids.map((id, i) => ({
      id, name: `${id}.png`, folder_id: null, folder_path: i === 0 ? "Folder 0" : null,
      created_at: 1_700_000_000 - i, uploaded_by: "u1", uploader_name: "Ada", mime_type: "image/png", extension: ".png",
    })),
  };
}
const DUP = {
  groups: [group("a", 100, ["a1", "a2", "a3"]), group("b", 50, ["b1", "b2"])],
  total_groups: 2, total_wasted_bytes: 250, pending: 0,
};

describe("duplicates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDuplicates.mockResolvedValue(DUP as never);
    mockDeleteDuplicates.mockResolvedValue({ deleted: 1, total: 1 });
  });

  it("is Turkish: header, groups, selection bar and the confirm dialog", async () => {
    const r = await renderInLocale(withQuery(<DuplicatesScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    fireEvent.press(screen.getByTestId("duplicates-select-all-but-newest"));
    expect(leftover("tr")).toEqual([]);
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    expect(leftover("tr")).toEqual([]);
    expect(r.leftover({ allow: [...DATA] })).toEqual([]);
    expect(screen.getByTestId("screen-title").props.children).toBe(moduleT("duplicates.heading.duplicates"));
  });

  it("is Turkish when every copy of a group is selected, still scanning and truncated", async () => {
    mockGetDuplicates.mockResolvedValue({ ...DUP, total_groups: 340, pending: 4 } as never);
    await renderInLocale(withQuery(<DuplicatesScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("duplicates-scanning")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    for (const id of ["b1", "b2"]) fireEvent.press(screen.getByTestId(`dup-file-${id}`));
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    expect(screen.getByText(/Bu işlem|tüm kopyalar/)).toBeTruthy();
    expect(leftover("tr")).toEqual([]);
  });

  it("is Turkish for the empty and error states", async () => {
    mockGetDuplicates.mockResolvedValue({ groups: [], total_groups: 0, total_wasted_bytes: 0, pending: 0 } as never);
    await renderInLocale(withQuery(<DuplicatesScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("duplicates-empty")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByText(moduleT("duplicates.label.nothingStoredTwice"))).toBeTruthy();
  });

  it("is Turkish when the check fails", async () => {
    mockGetDuplicates.mockRejectedValue(new Error("boom"));
    await renderInLocale(withQuery(<DuplicatesScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("duplicates-error")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByText(moduleT("duplicates.error.couldnTCheckForDuplicates"))).toBeTruthy();
  });

  it("toasts in the language: moved all, moved some, failed", async () => {
    await renderInLocale(withQuery(<DuplicatesScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    const trash = async (result: { deleted: number; total: number } | Error) => {
      if (result instanceof Error) mockDeleteDuplicates.mockRejectedValueOnce(result);
      else mockDeleteDuplicates.mockResolvedValueOnce(result);
      fireEvent.press(screen.getByTestId("duplicates-select-all-but-newest"));
      fireEvent.press(screen.getByTestId("duplicates-delete"));
      fireEvent.press(screen.getByTestId("confirm"));
      await waitFor(() => expect(mockToast).toHaveBeenCalled());
    };
    await trash({ deleted: 3, total: 3 });
    expect(mockToast.mock.calls[0][0]).toBe(moduleT("duplicates.status.movedDeletedToTrash", { deleted: 3 }));
    mockToast.mockClear();
    await trash({ deleted: 2, total: 3 });
    expect(mockToast.mock.calls[0][0]).toBe(moduleT("duplicates.status.movedDeletedOfTotalToTrash", { deleted: 2, total: 3 }));
    mockToast.mockClear();
    await trash(Object.assign(new Error(""), { message: "" }));
    expect(mockToast.mock.calls[0][0]).toBe("");
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => String(c[0])), "tr")).toEqual([]);
  });

  it("falls back to the translated message when the failure carries none", async () => {
    await renderInLocale(withQuery(<DuplicatesScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    mockDeleteDuplicates.mockRejectedValueOnce("not an error object");
    fireEvent.press(screen.getByTestId("duplicates-select-all-but-newest"));
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(moduleT("duplicates.error.couldNotMoveThoseToTrash"), "error");
    expect(moduleT("duplicates.error.couldNotMoveThoseToTrash")).not.toBe("Could not move those to trash");
  });

  it("switches language in place while mounted", async () => {
    const { setTo, Probe } = switcher();
    await renderInLocale(withQuery(<><DuplicatesScreen /><Probe /></>), "en");
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    expect(screen.getByText("All but newest")).toBeTruthy();
    expect(screen.getByText("2 groups · 250 B reclaimable")).toBeTruthy();
    await setTo("de");
    await waitFor(() => expect(screen.queryByText("All but newest")).toBeNull());
    expect(screen.getByText(moduleT("duplicates.label.allButNewest"))).toBeTruthy();
    expect(leftover("de")).toEqual([]);
  });

  it("reads right in Polish for 1, 3 and 5 (groups, scanning, confirm title)", async () => {
    await renderInLocale(<></>, "pl");
    expectPolishForms((n) => moduleT("duplicates.label.countPluralOneGroupOtherGroupsSizeReclaimable", { count: n, size: "1 KB" }));
    expectPolishForms((n) => moduleT("duplicates.description.stillScanningPendingPluralOneFileOtherFilesThisListWillFillIn", { pending: n }));
    expectPolishForms((n) => moduleT("duplicates.heading.moveCountPluralOneFileOtherFilesToTrash", { count: n }));
    // and the screen asks for exactly these messages
    mockGetDuplicates.mockResolvedValue({ ...DUP, total_groups: 3, pending: 5 } as never);
    await renderInLocale(withQuery(<DuplicatesScreen />), "pl");
    await waitFor(() => expect(screen.getByTestId("duplicates-scanning")).toBeTruthy());
    expect(screen.getByTestId("duplicates-scanning")).toHaveTextContent(moduleT("duplicates.description.stillScanningPendingPluralOneFileOtherFilesThisListWillFillIn", { pending: 5 }));
    expect(screen.getByText(/^3 grupy/)).toBeTruthy();
  });

  it("keeps the English wording and spacing", async () => {
    mockGetDuplicates.mockResolvedValue({ ...DUP, total_groups: 340, pending: 1, groups: [DUP.groups[0]] } as never);
    await renderInLocale(withQuery(<DuplicatesScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("duplicates-scanning")).toBeTruthy());
    expect(screen.getByTestId("duplicates-scanning")).toHaveTextContent("Still scanning 1 file - this list will fill in.");
    expect(screen.getByTestId("duplicates-truncated")).toHaveTextContent("Showing the 1 largest groups of 340. Clean these up and the rest move up.");
    expect(screen.getByText("3 copies · 200 B")).toBeTruthy();
    expect(screen.getByText("newest")).toBeTruthy();
    expect(screen.getAllByText("Workspace root").length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId("dup-file-a1"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByText("100 B reclaimable")).toBeTruthy();
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    expect(screen.getByText("Move 1 file to trash?")).toBeTruthy();
    expect(screen.getByText("This reclaims 100 B. They go to trash, not straight out.")).toBeTruthy();
    for (const id of ["a2", "a3"]) fireEvent.press(screen.getByTestId(`dup-file-${id}`));
    expect(screen.getByText("Move 3 files to trash?")).toBeTruthy();
    expect(screen.getByText("This reclaims 300 B. 1 group has every copy selected - no copy will be left.")).toBeTruthy();
  });
});

// ============================ map ============================

const pin = (id: string) => ({ kind: "file" as const, id, name: `${id}.jpg`, latitude: 1, longitude: 2, source: "exif" as const });

describe("map", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPins.mockResolvedValue({ pins: [pin("f1"), pin("f2")], counts: { gps: 2, approximate: 0, pending: 0 } });
    mockBasemap.mockResolvedValue(true);
  });

  it("is Turkish with pins, empty and failed", async () => {
    await renderInLocale(withQuery(<MapScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("map-count")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByTestId("screen-title").props.children).toBe(moduleT("map.heading.map"));
    expect(screen.getByTestId("map-count")).toHaveTextContent(moduleT("map.label.gpsLocated", { gps: 2 }));
    __resetI18nForTests();

    mockPins.mockResolvedValue({ pins: [], counts: { gps: 0, approximate: 0, pending: 0 } });
    await renderInLocale(withQuery(<MapScreen />), "tr");
    await waitFor(() => expect(screen.getAllByTestId("map-empty").length).toBeGreaterThan(0));
    expect(leftover("tr")).toEqual([]);
    __resetI18nForTests();

    mockPins.mockRejectedValue(new Error("x"));
    await renderInLocale(withQuery(<MapScreen />), "tr");
    await waitFor(() => expect(screen.getAllByTestId("map-error").length).toBeGreaterThan(0));
    expect(leftover("tr")).toEqual([]);
  });

  it("keeps the English wording and switches in place", async () => {
    const { setTo, Probe } = switcher();
    await renderInLocale(withQuery(<><MapScreen /><Probe /></>), "en");
    await waitFor(() => expect(screen.getByTestId("map-count")).toBeTruthy());
    expect(screen.getByTestId("map-count")).toHaveTextContent("2 located");
    expect(screen.getByTestId("screen-title").props.children).toBe("Map");
    await setTo("de");
    await waitFor(() => expect(screen.getByTestId("screen-title").props.children).toBe(moduleT("map.heading.map")));
    expect(screen.getByTestId("map-count")).toHaveTextContent(moduleT("map.label.gpsLocated", { gps: 2 }));
  });

  it("the empty state keeps its English", async () => {
    mockPins.mockResolvedValue({ pins: [], counts: { gps: 0, approximate: 0, pending: 0 } });
    await renderInLocale(withQuery(<MapScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("map-empty")).toBeTruthy());
    expect(screen.getByText("No geotagged photos yet")).toBeTruthy();
    expect(screen.getByText("Photos taken on a phone usually carry GPS coordinates. Back them up and they will appear here, where they were taken.")).toBeTruthy();
  });
});

// ============================ library ============================

const item = (id: string, kind: LibraryKind): LibraryItem => ({
  id, name: `${id}.${kind === "photos" ? "jpg" : kind === "videos" ? "mp4" : "pdf"}`, size_bytes: 1, mime_type: "x/y", extension: "x",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0, folder_id: null, taken_at: 1718445600,
}) as LibraryItem;

function mockLib(kind: LibraryKind, over: Record<string, unknown> = {}, page: Partial<LibraryPage> = {}) {
  const p: LibraryPage = {
    total: 25, counts: { "2024-07": 23, "2024-06": 2 },
    months: [
      { key: "2024-07", label: "July 2024", files: [item("a", kind), item("b", kind)] },
      { key: "2024-06", label: "June 2024", files: [item("c", kind)] },
    ],
    next_cursor: "cur", ...page,
  };
  (useLibrary as jest.Mock).mockReturnValue({
    data: { pages: [p], pageParams: [null] }, isLoading: false, isError: false, isFetchingNextPage: false, isRefetching: false,
    hasNextPage: true, fetchNextPage: jest.fn(), refetch: jest.fn(), ...over,
  });
}

describe("library", () => {
  const kinds: LibraryKind[] = ["photos", "videos", "documents"];

  it.each(kinds)("is Turkish for %s: months, progress, load more and the end", async (kind) => {
    mockLib(kind);
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind={kind} layout="grid" />, "tr");
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByTestId("load-more")).toBeTruthy();
    __resetI18nForTests();
    mockLib(kind, { hasNextPage: false }, { next_cursor: null, total: 3 });
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind={kind} layout="grid" />, "tr");
    expect(leftover("tr")).toEqual([]);
  });

  it.each(kinds)("is Turkish for the empty and error states of %s", async (kind) => {
    mockLib(kind, {}, { months: [], total: 0, next_cursor: null });
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind={kind} layout="grid" />, "tr");
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByTestId(`${kind}-empty`)).toBeTruthy();
    __resetI18nForTests();
    mockLib(kind, { isError: true, data: undefined });
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind={kind} layout="grid" />, "tr");
    expect(leftover("tr")).toEqual([]);
  });

  it("keeps the English wording", async () => {
    mockLib("videos");
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind="videos" layout="grid" />, "en");
    expect(screen.getByText("23 videos")).toBeTruthy();
    expect(screen.getByText("· 2 loaded")).toBeTruthy();
    expect(screen.getByText("Showing 3 of 25 videos")).toBeTruthy();
    expect(screen.getByText("Load 22 more")).toBeTruthy();
    __resetI18nForTests();
    mockLib("documents", { hasNextPage: false }, { next_cursor: null, total: 1 });
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind="documents" layout="grid" />, "en");
    expect(screen.getByText("That's all 1 document.")).toBeTruthy();
    __resetI18nForTests();
    mockLib("photos", {}, { months: [], total: 0, next_cursor: null });
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind="photos" layout="grid" />, "en");
    expect(screen.getByText("No photos yet")).toBeTruthy();
    expect(screen.getByText("Photos you upload or sync to any folder will show up here, by month.")).toBeTruthy();
    __resetI18nForTests();
    mockLib("photos", { isError: true });
    await renderInLocale(<LibraryBrowser workspaceId="w1" kind="photos" layout="grid" />, "en");
    expect(screen.getByText("Couldn't load photos.")).toBeTruthy();
  });

  it("switches language in place while mounted", async () => {
    mockLib("photos");
    const { setTo, Probe } = switcher();
    await renderInLocale(<><LibraryBrowser workspaceId="w1" kind="photos" layout="grid" /><Probe /></>, "en");
    expect(screen.getByText("23 photos")).toBeTruthy();
    await setTo("de");
    await waitFor(() => expect(screen.queryByText("23 photos")).toBeNull());
    expect(screen.getByText(moduleT("files.label.countPluralOnePhotoOtherPhotos", { count: 23 }))).toBeTruthy();
    expect(leftover("de")).toEqual([]);
  });

  it("reads right in Polish for 1, 3 and 5", async () => {
    await renderInLocale(<></>, "pl");
    for (const kind of kinds) {
      expectPolishForms((n) => plural(kind, n));
      const key = { photos: "Photo", videos: "Video", documents: "Document" }[kind];
      expectPolishForms((n) => moduleT(`files.description.thatSAllCountPluralOne${key}Other${key}s` as never, { count: n }));
    }
  });
});

// ============================ Vault ============================

type Calls = string[];
function fakeEngine(over: Partial<VaultEngine> = {}): VaultEngine & { calls: Calls } {
  const calls: Calls = [];
  return {
    calls,
    hasIdentity: async () => true,
    setup: async () => ({ recoveryKeyHex: "k" }),
    unlock: async () => {},
    unlockWithRecoveryKey: async () => {},
    lock: () => {},
    isUnlocked: () => true,
    createWorkspace: async () => {},
    setWorkspaceScope: async () => {},
    openWorkspace: async () => {},
    listMyWorkspaces: async () => [],
    listFolder: async () => [FOLDER, FILE],
    createFolder: async () => ({ folderId: "d2" }),
    uploadFile: async () => ({ fileId: "f-new" }),
    downloadFileTo: async () => ({ totalSize: 2048 }),
    deleteEntry: async () => {},
    ...over,
  } as unknown as VaultEngine & { calls: Calls };
}
const FOLDER: VaultEntry = { id: "d1", name: "Trip", kind: "folder", size: null, timestamp: 1 };
const FILE: VaultEntry = { id: "f1", name: "photo.jpg", kind: "file", size: 2048, timestamp: 2 };
const space = (over: Partial<KnownSpace> = {}): KnownSpace => ({ id: "ws-1", name: "Holiday trip", selfFounded: true, globalWorkspaceId: "gw-1", shared: false, ...over });

let engine: ReturnType<typeof fakeEngine>;
function resetVault(over: Partial<ReturnType<typeof useVault.getState>> = {}): void {
  useVault.setState({ status: "unlocked", hasIdentity: true, error: null, busy: false, spaces: [space()], activeSpaceId: "ws-1", entries: [], recoveryKeyOnce: null, transfers: {}, ...over });
  if (over.spaces) mockKeychain.set("dosya.vault.workspaces.u1", JSON.stringify(over.spaces));
  else mockKeychain.set("dosya.vault.workspaces.u1", JSON.stringify([space()]));
  useVault.getState().__setEngine(engine);
}

beforeEach(() => {
  mockKeychain.clear();
  Object.keys(mockParams).forEach((k) => delete mockParams[k]);
  mockRouter.push.mockClear();
  mockToast.mockClear();
  engine = fakeEngine();
  resetVault();
  useWorkspaceStore.setState({ activeId: "gw-1", hydrated: true });
  useAuthStore.setState({ status: "signedIn", user: { id: "u1", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null } as never);
});

describe("Vault front screen", () => {
  it("is Turkish at the gates: intro, set up, unlock with passphrase and recovery key, recovery key shown", async () => {
    // The intro pictures carry a line of hex and a masked passphrase: the same in every language.
    const ART = ["Vault", "8f3a c91e 7b20 d4e6 0a5f 92bc e17d 3b84 c6a0 5e29 f1d7 48ab", "••••••••••••"];
    engine = fakeEngine({ hasIdentity: async () => false });
    resetVault({ status: "locked", hasIdentity: false });
    await renderInLocale(<VaultScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-intro")).toBeTruthy());
    expect(leftover("tr", ART)).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-intro-next"));
    fireEvent.press(screen.getByTestId("vault-intro-next"));
    expect(screen.getByText(moduleT("vault.action.setUpVault"))).toBeTruthy();
    expect(leftover("tr", ART)).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-intro-setup"));
    await waitFor(() => expect(screen.getByTestId("vault-setup-pass")).toBeTruthy());
    expect(leftover("tr", ["Vault"])).toEqual([]);
    fireEvent.changeText(screen.getByTestId("vault-setup-pass"), "abc");
    fireEvent.changeText(screen.getByTestId("vault-setup-confirm"), "abd");
    expect(screen.getByText(moduleT("vault.error.passphrasesDoNotMatch"))).toBeTruthy();
    expect(leftover("tr", ["Vault"])).toEqual([]);
    __resetI18nForTests();

    engine = fakeEngine();
    resetVault({ status: "locked", hasIdentity: true });
    await renderInLocale(<VaultScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-unlock-pass")).toBeTruthy());
    expect(leftover("tr", ["Vault"])).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-recovery-toggle"));
    expect(screen.getByTestId("vault-recovery-submit")).toBeTruthy();
    expect(leftover("tr", ["Vault"])).toEqual([]);
    __resetI18nForTests();

    resetVault({ recoveryKeyOnce: "3f9a1c7e" });
    await renderInLocale(<VaultScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-recovery-key-value")).toBeTruthy());
    expect(leftover("tr", ["Vault", "3f9a", "1c7e"])).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-recovery-copy"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(moduleT("common.status.copied")));
    expect(moduleT("common.status.copied")).not.toBe("Copied");
    fireEvent.press(screen.getByTestId("vault-recovery-stored"));
    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    await waitFor(() => expect(screen.getByTestId("vault-ready")).toBeTruthy());
    expect(leftover("tr", ["Vault"])).toEqual([]);
  });

  it("is Turkish with Spaces, shared Spaces, the failed check and the New Space prompt", async () => {
    resetVault({ spaces: [space(), space({ id: "ws-2", name: "Team", shared: true })] });
    await renderInLocale(<VaultScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-new-space")).toBeTruthy());
    expect(leftover("tr", ["Vault", "Team"])).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-new-space"));
    expect(leftover("tr", ["Vault", "Team"])).toEqual([]);
    expect(screen.getByPlaceholderText(moduleT("vault.placeholder.spaceName"))).toBeTruthy();
    __resetI18nForTests();

    resetVault({ spaces: [] });
    await renderInLocale(<VaultScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-new-space")).toBeTruthy());
    expect(screen.getByText(moduleT("vault.description.noSpacesYetInThisWorkspace"))).toBeTruthy();
    expect(leftover("tr", ["Vault"])).toEqual([]);
    __resetI18nForTests();

    engine = fakeEngine({ hasIdentity: async () => { throw new Error("net"); } });
    resetVault({ status: "locked", hasIdentity: null });
    await renderInLocale(<VaultScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-retry")).toBeTruthy());
    expect(screen.getByText(moduleT("vault.error.couldnTCheckEncryptionStatus"))).toBeTruthy();
    expect(leftover("tr", ["Vault"])).toEqual([]);
  });

  it("keeps the English wording and switches in place", async () => {
    resetVault({ spaces: [space(), space({ id: "ws-2", name: "Team", shared: true })] });
    const { setTo, Probe } = switcher();
    await renderInLocale(<><VaultScreen /><Probe /></>, "en");
    await waitFor(() => expect(screen.getByTestId("vault-new-space")).toBeTruthy());
    expect(screen.getByText("My Spaces")).toBeTruthy();
    expect(screen.getByText("Shared with me")).toBeTruthy();
    expect(screen.getByText("What is Vault?")).toBeTruthy();
    expect(screen.getByText("Lock")).toBeTruthy();
    expect(screen.getByText("Your files are encrypted on this phone before they ever leave it. dosya only ever stores ciphertext.")).toBeTruthy();
    await setTo("de");
    await waitFor(() => expect(screen.queryByText("My Spaces")).toBeNull());
    expect(screen.getByText(moduleT("vault.heading.mySpaces"))).toBeTruthy();
    expect(leftover("de", ["Vault", "Team"])).toEqual([]);
  });
});

describe("Vault pieces", () => {
  it("SpaceRow, TransferBar and VaultEntryRow are Turkish", async () => {
    resetVault();
    const transfers = [
      { id: "t1", name: "photo.jpg", kind: "upload" as const, done: 10, total: 2048, error: "Disk is full on the server", retry: { folderId: "root", fileUri: "file:///x" } },
    ];
    await renderInLocale(
      <>
        <SpaceRow space={space({ shared: true })} onPress={() => {}} />
        <TransferBar transfers={transfers as never} onRetry={() => {}} onDismiss={() => {}} />
        <VaultEntryRow entry={FILE} onPress={() => {}} onMore={() => {}} />
      </>,
      "tr",
    );
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByText(moduleT("vault.status.sharedSpace"))).toBeTruthy();
    expect(screen.getByText(moduleT("common.action.dismiss"))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("files.accessibility.actionsForName", { name: "photo.jpg" }))).toBeTruthy();
    expect(screen.getByText(moduleT("common.label.sentOfTotal", { sent: formatBytes(10), total: formatBytes(2048) }))).toBeTruthy();
  });

  it("the setup and unlock screens are Turkish and the English is unchanged", async () => {
    await renderInLocale(<><PassphraseStep onBack={() => {}} /><UnlockCard /></>, "tr");
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByText(moduleT("vault.heading.chooseAPassphrase"))).toBeTruthy();

    await renderInLocale(<><PassphraseStep onBack={() => {}} /><UnlockCard /></>, "en");
    expect(screen.getByText("Choose a passphrase")).toBeTruthy();
    expect(screen.getByText("Unlock your Vault")).toBeTruthy();
    expect(screen.getByText("Use recovery key")).toBeTruthy();
    expect(screen.getByText("Confirm passphrase")).toBeTruthy();
  });
});

describe("Vault file screen", () => {
  beforeEach(() => {
    mockParams.spaceId = "ws-1"; mockParams.folderId = "root"; mockParams.entryId = "f1"; mockParams.name = "photo.jpg"; mockParams.size = "2048";
    mockParams.name = "report.pdf";
  });

  it("is Turkish: the stage, the toolbar and the delete confirmation", async () => {
    await renderInLocale(<VaultFileScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-file-stage-message")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-file-delete"));
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByText(moduleT("vault.description.thisCannotBeUndone"))).toBeTruthy();
    expect(screen.getByLabelText(moduleT("common.action.goBack"))).toBeTruthy();
  });

  it("is Turkish when the file cannot be opened, and its failed save and share toasts", async () => {
    engine = fakeEngine({ downloadFileTo: async () => { throw new Error("x"); } });
    resetVault();
    await renderInLocale(<VaultFileScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-file-error")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByLabelText(moduleT("common.back"))).toBeTruthy();
  });

  it("save and share failures toast in the language", async () => {
    const { saveToDevice } = jest.requireMock("@/files/saveToDevice") as { saveToDevice: jest.Mock };
    const { shareFile } = jest.requireMock("@/files/download") as { shareFile: jest.Mock };
    await renderInLocale(<VaultFileScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-file-stage-message")).toBeTruthy());
    saveToDevice.mockRejectedValueOnce("nope");
    shareFile.mockRejectedValueOnce("nope");
    await act(async () => { fireEvent.press(screen.getByTestId("vault-file-save")); });
    await act(async () => { fireEvent.press(screen.getByTestId("vault-file-share")); });
    expect(mockToast).toHaveBeenCalledWith(expect.any(String), "error");
    const msgs = mockToast.mock.calls.map((c) => c[0]);
    expect(msgs).toContain(moduleT("common.error.couldnTSaveThisFile"));
    expect(msgs).toContain(moduleT("common.error.couldnTShareThisFile"));
    expect(leftoverEnglish(msgs as string[], "tr")).toEqual([]);
  });

  it("keeps the English wording", async () => {
    await renderInLocale(<VaultFileScreen />, "en");
    await waitFor(() => expect(screen.getByTestId("vault-file-stage-message")).toBeTruthy());
    expect(screen.getByText("Save to device")).toBeTruthy();
    expect(screen.getByLabelText("Go back")).toBeTruthy();
    fireEvent.press(screen.getByTestId("vault-file-delete"));
    expect(screen.getByText('Delete "report.pdf"?')).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  });
});

describe("Vault Space folder screen", () => {
  beforeEach(() => {
    mockParams.id = "ws-1"; mockParams.folderId = "root"; mockParams.name = "Holiday trip";
  });

  it("is Turkish: header, list, add sheet, actions sheet, prompts and confirm", async () => {
    await renderInLocale(<VaultSpaceFolderScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    expect(leftover("tr")).toEqual([]);
    expect(screen.getByLabelText(moduleT("vault.action.addToThisSpace"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("vault-add"));
    expect(screen.getByText(moduleT("vault.label.uploadPhotosOrVideos"))).toBeTruthy();
    expect(screen.getByText(moduleT("vault.label.uploadAFile"))).toBeTruthy();
    expect(leftover("tr")).toEqual([]);
    fireEvent.press(screen.getByText(moduleT("common.action.newFolder")));
    finishSheetDismissal();
    expect(screen.getByPlaceholderText(moduleT("vault.error.folderName"))).toBeTruthy();
    expect(leftover("tr")).toEqual([]);
  });

  it("is Turkish for the actions sheet and the delete confirmation", async () => {
    await renderInLocale(<VaultSpaceFolderScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-entry-more-f1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-entry-more-f1"));
    expect(screen.getByText(moduleT("vault.action.saveToDevice"))).toBeTruthy();
    expect(leftover("tr")).toEqual([]);
    fireEvent.press(screen.getByText(moduleT("common.delete")));
    finishSheetDismissal();
    expect(screen.getByText(moduleT("vault.description.thisCannotBeUndone"))).toBeTruthy();
    expect(leftover("tr")).toEqual([]);
  });

  it("is Turkish when empty and when the picker cannot open", async () => {
    engine = fakeEngine({ listFolder: async () => [] });
    resetVault();
    mockPickPhotos.mockRejectedValue(new Error("x"));
    await renderInLocale(<VaultSpaceFolderScreen />, "tr");
    await waitFor(() => expect(screen.getByTestId("vault-folder-empty")).toBeTruthy());
    expect(screen.getByText(moduleT("vault.description.thisSpaceIsEmptyAddPhotosOrFilesWithTheButton"))).toBeTruthy();
    expect(leftover("tr")).toEqual([]);
    fireEvent.press(screen.getByTestId("vault-add"));
    fireEvent.press(screen.getByText(moduleT("vault.label.uploadAFile")));
    finishSheetDismissal();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(moduleT("common.error.couldnTOpenThePicker"), "error"));
    expect(moduleT("common.error.couldnTOpenThePicker")).not.toBe("Couldn't open the picker.");
  });

  it("is Turkish when locked underneath, and the fallback title translates", async () => {
    resetVault({ status: "locked" });
    delete mockParams.name;
    mockParams.folderId = "d1";
    await renderInLocale(<VaultSpaceFolderScreen />, "tr");
    expect(screen.getByTestId("screen-title").props.children).toBe(moduleT("vault.heading.space"));
    expect(leftover("tr")).toEqual([]);
  });

  it("keeps the English wording", async () => {
    await renderInLocale(<VaultSpaceFolderScreen />, "en");
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    expect(screen.getByLabelText("Add to this Space")).toBeTruthy();
    expect(screen.getByLabelText("Actions for photo.jpg")).toBeTruthy();
    fireEvent.press(screen.getByTestId("vault-add"));
    for (const s of ["Upload photos or videos", "Upload a file", "New folder"]) expect(screen.getByText(s)).toBeTruthy();
  });
});

describe("Vault store messages", () => {
  it("speak the language and keep the English", async () => {
    await renderInLocale(<></>, "tr");
    engine = fakeEngine({ unlock: async () => { throw new Error("bad"); }, unlockWithRecoveryKey: async () => { throw new Error("bad"); }, hasIdentity: async () => { throw new Error("net"); } });
    resetVault({ status: "locked" });
    await useVault.getState().unlock("x");
    expect(useVault.getState().error).toBe(moduleT("vault.error.couldnTUnlockCheckYourPassphraseAndTryAgain"));
    await useVault.getState().unlockWithRecoveryKey("x");
    expect(useVault.getState().error).toBe(moduleT("vault.error.thatRecoveryKeyDidnTUnlockYourVault"));
    await useVault.getState().checkIdentity();
    expect(useVault.getState().error).toBe(moduleT("vault.error.couldnTCheckEncryptionStatus"));
    expect(leftoverEnglish([String(useVault.getState().error)], "tr")).toEqual([]);
  });

  it("the discovered Space label reads in the language", async () => {
    await renderInLocale(<></>, "tr");
    engine = fakeEngine({ listMyWorkspaces: async () => [{ workspaceId: "ws-abcdef123", globalWorkspaceId: "g1", createdByMe: false }] as never });
    resetVault({ spaces: [] });
    await useVault.getState().refreshSpaces();
    const names = useVault.getState().spaces.map((s) => s.name);
    expect(names).toContain(moduleT("vault.label.sharedSelectTrueSharedSpaceOtherSpaceSlice", { shared: "true", slice: "abcdef" }));
  });

  it("the approved rewording: encryption status check", async () => {
    engine = fakeEngine({ hasIdentity: async () => { throw new Error("net"); } });
    resetVault({ status: "locked", hasIdentity: null });
    await renderInLocale(<></>, "en");
    await useVault.getState().checkIdentity();
    expect(useVault.getState().error).toBe("Could not check encryption status.");
  });

  it("upload, download and delete failures name the file in the language", async () => {
    await renderInLocale(<></>, "tr");
    engine = fakeEngine({
      uploadFile: async () => { throw new Error("x"); },
      downloadFileTo: async () => { throw new Error("x"); },
      deleteEntry: async () => { throw new Error("x"); },
    });
    resetVault();
    await useVault.getState().uploadFromUri("root", "report.pdf", "file:///x");
    expect(useVault.getState().error).toBe(moduleT("vault.error.couldnTUploadName", { name: "report.pdf" }));
    await useVault.getState().downloadToCache("root", FILE);
    expect(useVault.getState().error).toBe(moduleT("vault.error.couldnTDownloadName", { name: "photo.jpg" }));
    await useVault.getState().deleteEntry("root", FILE);
    expect(useVault.getState().error).toBe(moduleT("vault.error.couldnTDeleteName", { name: "photo.jpg" }));
    expect(leftoverEnglish([String(useVault.getState().error)], "tr", { allow: ["photo.jpg"] })).toEqual([]);
  });
});

// ============================ upload ============================

describe("upload messages", () => {
  beforeEach(() => {
    mockDisk.clear();
    __resetUploadQueuePersistence();
    useUploadStore.setState({ items: [], batchStartedAt: null, settledBk: { count: 0, bytes: 0 } } as never);
    mockStartUploads.mockClear();
    (apiRequest as jest.Mock).mockReset();
  });

  it("restored rows say why in the language", async () => {
    await renderInLocale(<></>, "tr");
    const row = (id: string, status: string) => ({ id, name: `${id}.pdf`, uri: `file:///cache/upload-share-${id}.pdf`, size: 1, mime: "application/pdf", folderId: null, workspaceId: "w1", status, progress: 0 });
    mockDisk.set(UPLOAD_QUEUE_FILE, JSON.stringify({ v: 1, items: [row("up_1_1000", "queued"), row("up_2_2000", "uploading")] }));
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => ({ exists: p.includes("up_2_2000"), isDirectory: false, size: 1 }));
    await hydrateUploadQueue();
    // The row holds a key; the text is read in the language chosen now.
    const errors = Object.fromEntries(useUploadStore.getState().items.map((i) => [i.id, itemErrorText(i, moduleT)]));
    expect(errors.up_1_1000).toBe(moduleT("upload.error.fileIsNoLongerOnThisDevice"));
    expect(errors.up_2_2000).toBe(moduleT("upload.label.interruptedTapToRetry"));
    expect(leftoverEnglish(Object.values(errors) as string[], "tr")).toEqual([]);
  });

  it("the quota warning toasts in the language", async () => {
    await renderInLocale(<></>, "tr");
    await startFromPicker({ picker: async () => [{ name: "a.jpg", uri: "file:///a", sizeBytes: 1, mimeType: "image/jpeg" } as never], workspaceId: "w1", folderId: null });
    expect(mockToast).toHaveBeenCalledWith(moduleT("upload.error.thisUploadMayNotFitInTheSpaceLeftInThisWorkspace"), "error");
    expect(leftoverEnglish([String(mockToast.mock.calls[0][0])], "tr")).toEqual([]);
  });

  it("a failed part is worded in the language yet still retried as transient", async () => {
    await renderInLocale(<></>, "tr");
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce({ ok: true, session_id: "s", upload_url: "/u", resumable: { part_size: 10, total_parts: 1, part_upload_url: "/p", complete_url: "/c", status_url: "/s" } })
      .mockResolvedValueOnce({ ok: true, uploaded_parts: [], total_parts: 1 });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("b64");
    (FileSystem.uploadAsync as jest.Mock).mockResolvedValue({ status: 503, body: "" });
    const bigItem = { id: "bk_1", name: "v.mp4", uri: "file://v", size: 5, mime: "video/mp4", folderId: "f", workspaceId: "w1", status: "queued", progress: 0 };
    let thrown: unknown;
    try { await uploadResumable(bigItem as never, "w1", () => {}); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toBe(moduleT("common.error.partPartNumberUploadFailedStatus", { partNumber: 1, status: "503" }));
    expect(message).not.toMatch(/upload failed/i);
    expect(classifyUploadError(message, thrown)).toBe("transient");
  });

  it("keeps the English classification of plain messages", () => {
    expect(classifyUploadError("Upload failed (503)")).toBe("transient");
    expect(classifyUploadError("Request timed out")).toBe("transient");
    expect(classifyUploadError("You are over your storage limit")).toBe("fatal");
    expect(classifyUploadError("Something odd")).toBe("hard");
  });
});
