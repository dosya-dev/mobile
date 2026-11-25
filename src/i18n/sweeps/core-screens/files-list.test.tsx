/**
 * Core-screen sweep: the Files list (FileBrowser) in tr, de, pl and zh-Hans
 * with no leftover English. Mocks follow ../b.test.tsx.
 */

import type { ReactElement } from "react";
import { fireEvent, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetI18nForTests } from "@/lib/i18n";
import { collectTexts, renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "@/files/viewPrefs";
import { useWorkspaces, useFileList, useSearch } from "@/files/hooks";
import { getTrash, getFavourites } from "@/files/api";
import type { FileItem, FolderItem } from "@/files/types";
import { FileBrowser } from "@/files/FileBrowser";
import { OrbitSheet } from "@/orbit/OrbitSheet";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import type { Locale } from "@/i18n/locales";

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
  (getTrash as jest.Mock).mockResolvedValue({ folders: [], files: [file({ id: "a", name: "a.pdf" }), file({ id: "b", name: "b.pdf" })], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 1 } });
  (getFavourites as jest.Mock).mockResolvedValue({ folders: [], files: [] });
});


async function expectClean(locale: Locale, ui: ReactElement, opts?: { allow?: string[]; after?: () => Promise<void> | void }) {
  const r = await renderInLocale(ui, locale);
  if (opts?.after) await opts.after();
  const texts = collectTexts();
  expect(texts.length).toBeGreaterThan(0);
  expect(r.leftover({ allow: [...DATA, ...(opts?.allow ?? [])] })).toEqual([]);
  return r;
}

describe.each(SWEEP_LOCALES)("Files list in %s", (locale) => {
  it("filters, controls and the empty state", async () => {
    await expectClean(locale, wrap(<FileBrowser folderId={null} />));
  });

  it("the error state with Retry", async () => {
    (useFileList as jest.Mock).mockReturnValue(listState({ isError: true, data: undefined }));
    await expectClean(locale, wrap(<FileBrowser folderId={null} />));
  });

  it("the grid, play all and the sort sheet", async () => {
    useViewPrefs.setState({ viewMode: "grid" });
    (useFileList as jest.Mock).mockReturnValue(
      listState({ data: { pages: [{ folders: [folder()], files: [file({ id: "au", name: "song.mp3", mime_type: "audio/mpeg", extension: "mp3" })], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] } }),
    );
    await expectClean(locale, wrap(<FileBrowser folderId={null} />), {
      allow: ["song.mp3"],
      after: () => { fireEvent.press(screen.getByTestId("open-sort")); },
    });
  });

  // The New folder prompt opens from the + sheet row.
  it("the list with a folder and a file, and the new folder prompt", async () => {
    (useFileList as jest.Mock).mockReturnValue(
      listState({ data: { pages: [{ folders: [folder()], files: [file()], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] } }),
    );
    await expectClean(locale, wrap(<><FileBrowser folderId={null} /><OrbitSheet visible onClose={() => {}} /></>), {
      after: () => { fireEvent.press(screen.getByTestId("orbit-new-folder")); finishSheetDismissal(); },
    });
  });
});
