/**
 * Unit B (files) in the chosen language: every owned screen, sheet and dialog
 * in Turkish with no leftover English, a switch while mounted, the plurals in
 * Polish for 1, 3 and 5, the alerts, and the approved rewordings in English.
 */
import type { ReactElement } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetI18nForTests, useLocale } from "@/lib/i18n";
import { captureAlerts, collectTexts, leftoverEnglish, renderInLocale } from "../../../test-utils/i18n-sweep";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "@/files/viewPrefs";
import { useShareIntentStore } from "@/share-intent/store";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaces, useFileList, useSearch } from "@/files/hooks";
import { getTrash, getFavourites } from "@/files/api";
import { toast } from "@/ui/toast";
import { toUploadDrafts } from "@/share-intent/copy";
import type { FileItem, FolderItem } from "@/files/types";
import { FileBrowser } from "@/files/FileBrowser";
import { OrbitSheet } from "@/orbit/OrbitSheet";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { FileActionsSheet } from "@/files/FileActionsSheet";
import { FolderActionsSheet } from "@/files/FolderActionsSheet";
import { FolderInfoDialog } from "@/files/FolderInfoDialog";
import { LockDialog } from "@/files/LockDialog";
import { DownloadRing } from "@/files/DownloadRing";
import { FileRow } from "@/files/FileRow";
import { FolderRow } from "@/files/FolderRow";
import { FirstLoadSplash } from "@/files/FirstLoadSplash";
import { WorkspaceHeader } from "@/files/WorkspaceHeader";
import { WorkspaceSwitcher } from "@/files/WorkspaceSwitcher";
import { WorkspaceSwitchSplash } from "@/files/WorkspaceSwitchSplash";
import { LocationPicker } from "@/files/LocationPicker";
import { progressCaption, ringLabel, type DownloadEntry } from "@/files/downloadModel";
import { describePurgeReport } from "@/files/purge";
import { describeFolderPurge } from "@/files/folderPurge";
import { deriveFirstLoadStage } from "@/files/firstLoadStage";
import { saveOutcomeMessage } from "@/files/saveToDevice";
import {
  LOCK_MODE_OPTIONS, describeLockMode, describeLockStatus, describeLockTarget, describeProtection,
  lockActionLabel, passwordFieldLabel, passwordHint,
} from "@/files/protection";
import TrashScreen from "../../../app/trash";
import FavouritesScreen from "../../../app/favourites";
import SearchScreen from "../../../app/search";
import PickDestination from "../../../app/pick-destination";
import SaveTo from "../../../app/save-to";
import FolderScreen from "../../../app/(tabs)/(files)/folder/[id]";

// Function declarations are hoisted, so the factories below can call them lazily.
function mockRouterModule(): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require("react");
  const { Text, View } = require("react-native");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  // Title as text, headerRight rendered: the header controls are part of the screen.
  const Screen = ({ options }: { options?: { title?: string; headerRight?: () => unknown } }) =>
    React.createElement(
      View,
      null,
      options?.title ? React.createElement(Text, { testID: "screen-title" }, options.title) : null,
      options?.headerRight ? options.headerRight() : null,
    );
  return {
    Stack: { Screen },
    useRouter: () => router,
    useLocalSearchParams: () => ({ id: "fo1", fileId: "f1", mode: "copy" }),
    // Focus on mount, blur on unmount, as a screen without a navigator.
    useFocusEffect: (cb: () => void | (() => void)) => { React.useEffect(cb, [cb]); },
    router,
  };
}
function mockNull(): null {
  return null;
}
jest.mock("expo-router", () => mockRouterModule());
jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/files/hooks", () => ({
  useWorkspaces: jest.fn(),
  useFileList: jest.fn(),
  useSearch: jest.fn(),
  useFile: jest.fn(),
}));
jest.mock("@/files/api", () => ({ ...jest.requireActual("@/files/api"), getTrash: jest.fn(), getFavourites: jest.fn() }));
jest.mock("@/files/mutations", () => ({
  ...jest.requireActual("@/files/mutations"),
  deleteFile: jest.fn(),
  restoreFile: jest.fn(),
}));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, userId: "u1", rootFolderId: null, rootFolderName: null }),
}));
jest.mock("@/player/controller", () => ({ playFolder: jest.fn(async () => true) }));
jest.mock("@/library/LibraryBrowser", () => ({ LibraryBrowser: () => mockNull() }));
jest.mock("@/groups/AddToGroupSheet", () => ({ AddToGroupSheet: () => mockNull() }));
jest.mock("@/notifications/NotificationBell", () => ({ NotificationBell: () => mockNull() }));
jest.mock("@/account/DeletionBanner", () => ({ DeletionBanner: () => mockNull() }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/upload/controller", () => ({ startUploads: jest.fn() }));
jest.mock("@/share-intent/copy", () => ({ toUploadDrafts: jest.fn() }));
jest.mock("@/share-intent/incoming", () => ({ discardSharedFiles: jest.fn(async () => {}) }));

const mockToast = toast as jest.Mock;

// Names and ids that are user data or brand text, never translated.
const DATA = ["Acme", "Beta", "old.pdf", "a.pdf", "b.pdf", "Documents", "Photos", "dosya.dev"];
// Shared controls in src/ui (unit K): the dialogs' default Cancel and the
// password field's toggle. They are English until that unit lands.

function file(over: Partial<FileItem> = {}): FileItem {
  return {
    id: "f1", name: "old.pdf", size_bytes: 2048, mime_type: "application/pdf", extension: "pdf",
    created_at: 1700000000, updated_at: 1700000000, current_version: 1, lock_mode: "none",
    share_count: 0, comment_count: 0, is_hidden: 0, ...over,
  };
}
function folder(over: Partial<FolderItem> = {}): FolderItem {
  return {
    id: "fo1", name: "Documents", created_at: 1700000000, lock_mode: "none", file_count: 3,
    is_synced: 0, is_hidden: 0, hidden_mode: "none", ...over,
  } as FolderItem;
}

const WS = [
  { id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, role_id: "role_owner", joined_at: 1, storage: { used: 100, total: 4096 } },
  { id: "w2", name: "Beta", slug: "beta", icon_initials: "BE", icon_color: "#2f6fd0", icon_image_url: null, role_id: "role_member", joined_at: 1 },
];

let qc: QueryClient;
function wrap(ui: ReactElement): ReactElement {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}
afterEach(() => qc?.clear());

const listState = (over: Record<string, unknown> = {}) => ({
  data: { pages: [{ folders: [], files: [], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
  isLoading: false, isPending: false, isError: false, isRefetching: false,
  isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  useWorkspaceStore.setState({ activeId: "w1" });
  useViewPrefs.setState({ viewMode: "list", libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT }, hydrated: true });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: WS, isLoading: false, isPending: false });
  (useFileList as jest.Mock).mockReturnValue(listState());
  (useSearch as jest.Mock).mockReturnValue({ data: { files: [], folders: [] }, isFetching: false });
  (getTrash as jest.Mock).mockResolvedValue({
    folders: [], files: [file({ id: "a", name: "a.pdf" }), file({ id: "b", name: "b.pdf" })], breadcrumbs: [],
    pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 1 },
  });
  (getFavourites as jest.Mock).mockResolvedValue({ folders: [], files: [] });
});

const noop = () => {};
const sheetProps = {
  visible: true, onClose: noop, onMove: noop, onCopy: noop, onVersions: noop, onRename: noop, onDelete: noop,
  onShare: noop, onLock: noop, onToggleHidden: noop, onComments: noop,
};

async function expectClean(ui: ReactElement, opts?: { allow?: string[]; after?: () => Promise<void> | void }) {
  const r = await renderInLocale(ui, "tr");
  if (opts?.after) await opts.after();
  const texts = collectTexts();
  expect(texts.length).toBeGreaterThan(0);
  expect(r.leftover({ allow: [...DATA, ...(opts?.allow ?? [])] })).toEqual([]);
  return r;
}

describe("unit B in Turkish", () => {
  it("FileBrowser: filters, controls, empty state", async () => {
    await expectClean(wrap(<FileBrowser folderId={null} />));
  });

  it("FileBrowser: error state with Retry", async () => {
    (useFileList as jest.Mock).mockReturnValue(listState({ isError: true, data: undefined }));
    await expectClean(wrap(<FileBrowser folderId={null} />));
  });

  it("FileBrowser: grid, play all, and the sort sheet", async () => {
    useViewPrefs.setState({ viewMode: "grid" });
    (useFileList as jest.Mock).mockReturnValue(
      listState({ data: { pages: [{ folders: [folder()], files: [file({ id: "au", name: "song.mp3", mime_type: "audio/mpeg", extension: "mp3" })], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] } }),
    );
    await expectClean(wrap(<FileBrowser folderId={null} />), {
      allow: ["song.mp3"],
      after: () => { fireEvent.press(screen.getByTestId("open-sort")); },
    });
  });

  // New folder lives in the + sheet; the browser publishes the target it offers it for.
  it("FileBrowser: new folder prompt from the + sheet", async () => {
    await expectClean(wrap(<><FileBrowser folderId={null} /><OrbitSheet visible onClose={() => {}} /></>), {
      after: () => { fireEvent.press(screen.getByTestId("orbit-new-folder")); finishSheetDismissal(); },
    });
  });

  it("FileBrowser: hide and unhide confirms through the folder sheet", async () => {
    (useFileList as jest.Mock).mockReturnValue(
      listState({ data: { pages: [{ folders: [folder({ is_hidden: 1 })], files: [], breadcrumbs: [], pagination: { page: 1, total_pages: 1 }, can_hide: true, can_lock: true }] } }),
    );
    await expectClean(wrap(<FileBrowser folderId={null} />), {
      after: async () => {
        fireEvent.press(screen.getByTestId("more-folder-fo1"));
        fireEvent.press(screen.getByText("Gizlemeyi kaldır"));
      },
    });
  });

  it("FileActionsSheet and FolderActionsSheet", async () => {
    await expectClean(wrap(<FileActionsSheet file={file()} {...sheetProps} canLock canHide />));
    await expectClean(<FolderActionsSheet folder={folder()} {...sheetProps} onOpen={noop} onInfo={noop} onAddToGroup={noop} canLock canHide />);
    await expectClean(wrap(<FileActionsSheet file={file({ lock_mode: "view_only", is_hidden: 1, hidden_mode: "everyone" })} {...sheetProps} canLock canHide />));
  });

  it("FolderInfoDialog", async () => {
    await expectClean(<FolderInfoDialog folder={folder({ lock_mode: "full_lock", is_hidden: 1, hidden_mode: "everyone", is_synced: 1 } as never)} visible onClose={noop} />, { allow: ["fo1"] });
    await expectClean(<FolderInfoDialog folder={folder()} visible onClose={noop} />, { allow: ["fo1"] });
  });

  it("LockDialog for a file and a folder", async () => {
    await expectClean(
      <LockDialog target={{ kind: "file", id: "f1", name: "old.pdf", lock_mode: "full_lock", size_bytes: 3000, extension: "pdf" }} visible onClose={noop} onSaved={noop} />,
      { allow: ["PDF"] },
    );
    await expectClean(
      <LockDialog target={{ kind: "folder", id: "fo1", name: "Documents", lock_mode: "none", file_count: 4 }} visible onClose={noop} onSaved={noop} />,
    );
  });

  it("DownloadRing, FileRow and FolderRow", async () => {
    const states: DownloadEntry["phase"][] = ["preparing", "downloading", "saving", "done", "error"];
    for (const phase of states) {
      await expectClean(<DownloadRing entry={{ fileId: "f1", name: "x", phase, written: 50, total: 100, startedAt: 0 }} />);
    }
    await expectClean(<DownloadRing entry={undefined} />);
    await expectClean(<FileRow file={file({ live_video_id: "v" })} onPress={noop} onMore={noop} />, { allow: ["2.0 KB"] });
    await expectClean(<FileRow file={file({ id: "v", live_photo_id: "f1" })} onPress={noop} />);
    await expectClean(<FolderRow folder={folder()} onPress={noop} />);
  });

  it("FirstLoadSplash failed and slow", async () => {
    await expectClean(<FirstLoadSplash inputs={{ hasUser: false, workspaceReady: false, filesReady: false }} failed onRetry={noop} />);
    useAuthStore.setState({ user: null });
    jest.useFakeTimers();
    try {
      await renderInLocale(<FirstLoadSplash inputs={{ hasUser: false, workspaceReady: false, filesReady: false }} failed={false} onRetry={noop} />, "tr");
      act(() => { jest.advanceTimersByTime(20000); });
      expect(leftoverEnglish(collectTexts(), "tr")).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
    for (const i of [
      { hasUser: false, workspaceReady: false, filesReady: false },
      { hasUser: true, workspaceReady: false, filesReady: false },
      { hasUser: true, workspaceReady: true, filesReady: false },
    ]) {
      await expectClean(<FirstLoadSplash inputs={i} failed={false} onRetry={noop} />);
    }
  });

  it("WorkspaceHeader, WorkspaceSwitcher (open sheet and create), switch splash", async () => {
    await expectClean(wrap(<WorkspaceHeader back />));
    await expectClean(wrap(<WorkspaceSwitcher />), {
      after: () => { fireEvent.press(screen.getByTestId("ws-trigger")); },
    });
    await expectClean(wrap(<WorkspaceSwitcher />), {
      after: () => {
        fireEvent.press(screen.getByTestId("ws-trigger"));
        fireEvent.press(screen.getByTestId("ws-create"));
      },
    });
    await expectClean(<WorkspaceSwitchSplash workspace={WS[0] as never} />);
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
    await expectClean(wrap(<WorkspaceSwitcher />));
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
    await expectClean(wrap(<WorkspaceSwitcher />));
  });

  it("LocationPicker", async () => {
    const regions = [{ code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" }];
    await expectClean(<LocationPicker regions={regions} value="eu-west-1" onChange={noop} />, { allow: ["Europe", "Dublin, Ireland"] });
    await expectClean(<LocationPicker regions={[]} value="" onChange={noop} />);
    await expectClean(<LocationPicker regions={regions} value="" onChange={noop} />, {
      allow: ["Europe", "Dublin, Ireland"],
      after: () => { fireEvent.changeText(screen.getByTestId("location-search"), "zzzz"); },
    });
  });

  it("trash screen, with the confirm dialogs", async () => {
    await expectClean(wrap(<TrashScreen />), {
      after: async () => {
        await waitFor(() => expect(screen.getByTestId("purge-a")).toBeTruthy());
        fireEvent.press(screen.getByTestId("purge-a"));
      },
    });
    await expectClean(wrap(<TrashScreen />), {
      after: async () => {
        await waitFor(() => expect(screen.getByTestId("empty-trash")).toBeTruthy());
        fireEvent.press(screen.getByTestId("empty-trash"));
      },
    });
    (getTrash as jest.Mock).mockResolvedValue({ folders: [], files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } });
    await expectClean(wrap(<TrashScreen />));
  });

  it("favourites, search and pick-destination", async () => {
    await expectClean(wrap(<FavouritesScreen />));
    await expectClean(wrap(<SearchScreen />), {
      after: () => { fireEvent.changeText(screen.getByTestId("search-input"), "zzz"); },
    });
    await expectClean(wrap(<SearchScreen />), {
      after: () => { fireEvent.press(screen.getByTestId("search-sort")); },
    });
    await expectClean(wrap(<PickDestination />));
  });

  it("save-to: empty and with files", async () => {
    useShareIntentStore.setState({ pending: [] });
    await expectClean(wrap(<SaveTo />));
    useShareIntentStore.setState({
      pending: [1, 2, 3, 4].map((n) => ({ uri: `content://x/${n}`, name: `file-${n}.pdf`, size: 1400, mime: "application/pdf" })),
    });
    (useFileList as jest.Mock).mockReturnValue(listState({ data: { pages: [{ folders: [folder()], files: [] }] } }));
    await expectClean(wrap(<SaveTo />), { allow: ["file-1.pdf", "file-2.pdf", "file-3.pdf"] });
  });

  it("folder screen header controls", async () => {
    await expectClean(wrap(<FolderScreen />));
  });

  it("module helpers", async () => {
    await renderInLocale(<></>, "tr");
    const entry = (phase: DownloadEntry["phase"]): DownloadEntry => ({ fileId: "f", name: "x", phase, written: 2048, total: 4096, startedAt: 0 });
    const texts = [
      progressCaption(entry("saving"), 1000), progressCaption(entry("done"), 1000), progressCaption(entry("error"), 1000),
      progressCaption(entry("downloading"), 4000),
      ...(["idle", "preparing", "downloading", "saving", "done", "error"] as const).map(ringLabel),
      describePurgeReport({ outcomes: [], succeeded: ["a"], failed: [] }),
      describePurgeReport({ outcomes: [], succeeded: [], failed: ["a"] }),
      describePurgeReport({ outcomes: [], succeeded: ["a"], failed: ["b"] }),
      describeFolderPurge({ complete: true, filesAffected: 0, remaining: 0, calls: 1 }),
      describeFolderPurge({ complete: true, filesAffected: 2, remaining: 0, calls: 1 }),
      describeFolderPurge({ complete: false, filesAffected: 2, remaining: 9, calls: 1 }),
      deriveFirstLoadStage({ hasUser: false, workspaceReady: false, filesReady: false }).label,
      deriveFirstLoadStage({ hasUser: true, workspaceReady: false, filesReady: false }).label,
      deriveFirstLoadStage({ hasUser: true, workspaceReady: true, filesReady: false }).label,
      saveOutcomeMessage({ kind: "gallery" }), saveOutcomeMessage({ kind: "folder" }),
      saveOutcomeMessage({ kind: "shared", reason: "too-large" }), saveOutcomeMessage({ kind: "shared" }),
      ...LOCK_MODE_OPTIONS.map((o) => o.label),
      ...(["file", "folder"] as const).flatMap((k) => (["none", "view_only", "full_lock"] as const).map((m) => describeLockMode(k, m))),
      lockActionLabel({ selected: "none", current: "none" }), lockActionLabel({ selected: "view_only", current: "none" }),
      lockActionLabel({ selected: "full_lock", current: "none" }), lockActionLabel({ selected: "full_lock", current: "full_lock" }),
      lockActionLabel({ selected: "none", current: "none", loading: true }),
      passwordFieldLabel("none"), passwordFieldLabel("full_lock"), passwordHint("none"), passwordHint("full_lock"),
      describeLockStatus({ lock_mode: "full_lock" }) as string, describeLockStatus({ lock_mode: "view_only" }) as string,
      describeLockStatus({ lock_mode: "full_lock", locked_by_name: "Ayse", lockedWhen: "dun" }) as string,
      describeLockStatus({ lock_mode: "view_only", locked_by_name: "Ayse" }) as string,
      describeLockStatus({ lock_mode: "view_only", lockedWhen: "dun" }) as string,
      describeLockTarget({ kind: "folder", file_count: 2, size: "1 KB" }), describeLockTarget({ kind: "file", extension: "pdf" }),
      describeLockTarget({ kind: "file" }),
      describeProtection({ lock_mode: "full_lock" }) as string, describeProtection({ lock_mode: "view_only" }) as string,
      describeProtection({ hidden_mode: "everyone" }) as string, describeProtection({ hidden_mode: "users" }) as string,
      describeProtection({ hidden_mode: "users", hidden_rule_count: 2 }) as string,
      describeProtection({ hidden_mode: "roles" }) as string, describeProtection({ hidden_mode: "roles", hidden_rule_count: 2 }) as string,
    ];
    expect(texts.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    expect(leftoverEnglish(texts, "tr", { allow: ["PDF", "Ayse"] })).toEqual([]);
  });
});

describe("plurals in Polish for 1, 3 and 5", () => {
  const purge = (n: number) => describePurgeReport({ outcomes: [], succeeded: Array.from({ length: n }, (_, i) => String(i)), failed: [] });
  const folderPurge = (n: number) => describeFolderPurge({ complete: true, filesAffected: n, remaining: 0, calls: 1 });

  it("purge reports, folder purges and item counts", async () => {
    await renderInLocale(<></>, "pl");
    expect([1, 3, 5].map(purge)).toEqual(["Usunięto 1 rzecz", "Usunięto 3 rzeczy", "Usunięto 5 rzeczy"]);
    expect([1, 3, 5].map(folderPurge)).toEqual(["Usunięto - 1 plik", "Usunięto - 3 pliki", "Usunięto - 5 plików"]);
  });

  it("folder rows and the folder info", async () => {
    for (const [n, word] of [[1, "1 element"], [3, "3 elementy"], [5, "5 elementów"]] as const) {
      const r = await renderInLocale(<FolderRow folder={folder({ file_count: n })} onPress={noop} />, "pl");
      expect(screen.getByText(word)).toBeTruthy();
      r.unmount();
    }
  });

  it("the empty-trash question", async () => {
    const want: Record<number, string> = { 1: "1 element zostanie", 3: "3 elementy zostaną", 5: "5 elementów zostanie" };
    for (const n of [1, 3, 5]) {
      (getTrash as jest.Mock).mockResolvedValue({
        folders: [], files: Array.from({ length: n }, (_, i) => file({ id: `t${i}`, name: `t${i}.pdf` })), breadcrumbs: [],
        pagination: { page: 1, per_page: 100, total_files: n, total_pages: 1 },
      });
      const r = await renderInLocale(wrap(<TrashScreen />), "pl");
      await waitFor(() => expect(screen.getByTestId("empty-trash")).toBeTruthy());
      fireEvent.press(screen.getByTestId("empty-trash"));
      expect(collectTexts().some((x) => x.includes(want[n]))).toBe(true);
      r.unmount();
    }
  });

  it("the saving toast of save-to", async () => {
    const want: Record<number, string> = { 1: "Zapis: 1 plik", 3: "Zapis: 3 pliki", 5: "Zapis: 5 plików" };
    (useFileList as jest.Mock).mockReturnValue(listState({ data: { pages: [{ folders: [], files: [] }] } }));
    for (const n of [1, 3, 5]) {
      mockToast.mockClear();
      useShareIntentStore.setState({ pending: [{ uri: "content://x/1", name: "a.pdf", size: 10, mime: "application/pdf" }] });
      (toUploadDrafts as jest.Mock).mockResolvedValue({
        drafts: Array.from({ length: n }, (_, i) => ({ id: `d${i}`, name: "a.pdf", uri: "file:///a", size: 10, mime: "application/pdf", folderId: null, status: "queued", progress: 0 })),
        failed: [],
      });
      const r = await renderInLocale(wrap(<SaveTo />), "pl");
      fireEvent.press(screen.getByTestId("confirm-save-to"));
      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(want[n]));
      r.unmount();
    }
  });

  it("the kind line of the lock sheet and the hidden-from counts", async () => {
    await renderInLocale(<></>, "pl");
    expect([1, 3, 5].map((n) => describeLockTarget({ kind: "folder", file_count: n }))).toEqual([
      "Folder · 1 plik", "Folder · 3 pliki", "Folder · 5 plików",
    ]);
    expect([1, 3, 5].map((n) => describeProtection({ hidden_mode: "users", hidden_rule_count: n }))).toEqual([
      "Ukryty dla 1 osoby", "Ukryty dla 3 osób", "Ukryty dla 5 osób",
    ]);
  });
});

describe("alerts", () => {
  it("the Live Photo delete question is translated", async () => {
    const alerts = captureAlerts();
    try {
      (useFileList as jest.Mock).mockReturnValue(
        listState({ data: { pages: [{ folders: [], files: [file({ id: "still", name: "IMG.heic", mime_type: "image/heic", extension: "heic", live_video_id: "vid" })], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] } }),
      );
      await renderInLocale(wrap(<FileBrowser folderId={null} />), "tr");
      fireEvent.press(screen.getByTestId("more-still"));
      fireEvent.press(screen.getByText("Sil"));
      fireEvent.press(screen.getByTestId("confirm"));
      await waitFor(() => expect(alerts.calls.length).toBe(1));
      expect(alerts.calls[0].buttons).toHaveLength(3);
      expect(leftoverEnglish(alerts.texts(), "tr")).toEqual([]);
      expect(alerts.calls[0].title).not.toBe("Delete photo?");
    } finally {
      alerts.restore();
    }
  });
});

describe("switching the language while mounted", () => {
  function Probe({ to }: { to: "de" }) {
    const { setPreference } = useLocale();
    return <Switch onPress={() => void setPreference(to)} />;
  }
  function Switch({ onPress }: { onPress: () => void }) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pressable } = require("react-native");
    return <Pressable testID="switch-language" onPress={onPress} />;
  }

  it("favourites and trash follow", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><FavouritesScreen /></>), "en");
    expect(screen.getByText("No favourites yet")).toBeTruthy();
    fireEvent.press(screen.getByTestId("switch-language"));
    await waitFor(() => expect(screen.queryByText("No favourites yet")).toBeNull());
    expect(collectTexts()).toContain("Noch keine Favoriten");
  });

  it("the file browser follows", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><FileBrowser folderId={null} /></>), "en");
    expect(screen.getByText("This folder is empty")).toBeTruthy();
    fireEvent.press(screen.getByTestId("switch-language"));
    await waitFor(() => expect(screen.queryByText("This folder is empty")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: DATA })).toEqual([]);
  });

  it("a held download ring label follows", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><FileRow file={file()} onPress={noop} /></>), "en");
    fireEvent.press(screen.getByTestId("switch-language"));
    await waitFor(() => expect(leftoverEnglish(collectTexts(), "de", { allow: DATA })).toEqual([]));
  });
});

describe("English stays as it was, except the approved rewordings", () => {
  it("search sort options read Name A-Z / Name Z-A", async () => {
    await renderInLocale(wrap(<SearchScreen />), "en");
    fireEvent.press(screen.getByTestId("search-sort"));
    expect(screen.getByText("Name A-Z")).toBeTruthy();
    expect(screen.getByText("Name Z-A")).toBeTruthy();
    expect(screen.getByText("Newest first")).toBeTruthy();
  });

  it("the empty folder reads without a full stop, the switcher without an ellipsis", async () => {
    await renderInLocale(wrap(<FileBrowser folderId={null} />), "en");
    expect(screen.getByText("This folder is empty")).toBeTruthy();
  });

  it("untouched English: toasts, dialogs and captions", async () => {
    await renderInLocale(<></>, "en");
    expect(describePurgeReport({ outcomes: [], succeeded: ["a"], failed: [] })).toBe("1 item deleted");
    expect(describePurgeReport({ outcomes: [], succeeded: [], failed: ["a", "b"] })).toBe("Nothing was deleted, 2 failed");
    expect(describeFolderPurge({ complete: false, filesAffected: 1, remaining: 4, calls: 1 })).toBe(
      "Still emptying - 1 file removed so far, about 4 to go. Delete it again to carry on.",
    );
    expect(describeLockTarget({ kind: "folder", file_count: 14, size: "3.1 MB" })).toBe("Folder · 14 files · 3.1 MB");
    expect(describeLockTarget({ kind: "file", extension: "jpg", size: "3.1 MB" })).toBe("JPG · 3.1 MB");
    expect(describeLockStatus({ lock_mode: "full_lock", locked_by_name: "Ann", lockedWhen: "today" })).toBe("Password lock · set by Ann, today");
    expect(passwordHint("full_lock")).toBe("At least 8 characters. Replaces the current one.");
    expect(describeProtection({ hidden_mode: "roles", hidden_rule_count: 1 })).toBe("Hidden from 1 role");
    expect(progressCaption({ fileId: "f", name: "x", phase: "downloading", written: 1024, total: 4096, startedAt: 0 }, 2000)).toContain(" · ");
  });
});
