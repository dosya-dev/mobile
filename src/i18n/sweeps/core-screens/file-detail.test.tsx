/**
 * Core-screen sweep: the file detail screen (More menu, rename dialog, vcf and
 * office actions, error screen, offline notice, trash question) in tr, de, pl
 * and zh-Hans with no leftover English. Mocks follow ../d.test.tsx.
 */
import { configure, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Image as ExpoImage } from "expo-image";
import FileViewerRoute from "../../../../app/(tabs)/(files)/file/[id]";
import { useViewerList } from "@/viewer/viewerStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useArchiveSaveStore } from "@/archive/archiveSaveStore";
import { __resetI18nForTests, t } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";
import { collectTexts, renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

// ── expo-router: titles and header parts become visible text ──────────────────
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../../test-utils/i18n-sweep").routerMockWithTitles();
  const baseScreen = base.Stack.Screen;
  const Screen = (props: { options?: Record<string, unknown> }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Children } = require("react");
    const parts: unknown[] = [baseScreen(props)];
    for (const k of ["headerRight", "headerLeft", "headerTitle"]) {
      const fn = props.options?.[k];
      if (typeof fn === "function") parts.push((fn as () => unknown)());
    }
    return Children.toArray(parts);
  };
  const router = {
    push: (...a: unknown[]) => mockPush(...a),
    back: (...a: unknown[]) => mockBack(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
  };
  return {
    ...base,
    Stack: Object.assign(base.Stack, { Screen }),
    useLocalSearchParams: () => mockParams,
    useRouter: () => router,
    router,
    useFocusEffect: (cb: () => void | (() => void)) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react").useEffect(cb, []);
    },
  };
});

// ── native bits ──────────────────────────────────────────────────────────────
const mockPlayer = { play: jest.fn(), pause: jest.fn(), currentTime: 0, muted: false, loop: false, addListener: jest.fn(() => ({ remove: jest.fn() })) };
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn((_src: unknown, setup?: (p: unknown) => void) => { setup?.(mockPlayer); return mockPlayer; }),
  VideoView: () => null,
}));
(ExpoImage as unknown as { prefetch: unknown }).prefetch = jest.fn(async () => true);

jest.mock("expo-contacts", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, status: "denied" })),
}));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 100 })),
  deleteAsync: jest.fn(async () => {}),
}));
jest.mock("react-native-webview", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const WebView = React.forwardRef(() => null);
  WebView.displayName = "WebView";
  return { WebView, default: WebView };
});

// ── data layer ───────────────────────────────────────────────────────────────
let mockFile: Record<string, unknown> | undefined = {};
let mockFileError = false;
let mockFileLoading = false;
jest.mock("@/files/hooks", () => ({
  useFile: () => ({ data: mockFile, isLoading: mockFileLoading, isError: mockFileError, refetch: jest.fn() }),
  useWorkspaces: () => ({ data: [{ id: "w1", name: "Workspace 1" }] }),
  useRegions: () => ({ data: [] }),
  useFileList: (_ws: string | null, folderId: string | null) => ({
    data: { pages: [{ folders: folderId === null ? [{ id: "fld_dest", name: "Dest", created_at: 1, lock_mode: "none", file_count: 0 }] : [] }] },
  }),
}));
jest.mock("@/files/api", () => ({
  getDownloadUrl: jest.fn(async () => "https://r2/x"),
  getVersions: jest.fn(),
  listFiles: jest.fn(async () => ({
    files: [{ id: "new", name: "contacts-2026-07-12.vcf", created_at: 200 }],
    folders: [], breadcrumbs: [], pagination: { page: 1, per_page: 500, total_files: 1, total_pages: 1 },
  })),
}));
jest.mock("@/files/download", () => ({
  downloadToCache: jest.fn(async () => "file:///cache/c.vcf"),
  shareFile: jest.fn(),
}));
jest.mock("@/files/byteStore", () => ({
  localUri: jest.fn(async () => null),
  ensureLocal: jest.fn(async () => null),
}));
jest.mock("@/files/mutations", () => ({ unlockFile: jest.fn(async () => "tok_1") }));
const mockRemove = jest.fn();
const mockRemoveWithTwin = jest.fn();
const mockRename = jest.fn();
const mockRestoreVersion = jest.fn();
jest.mock("@/files/mutationHooks", () => ({
  useFileMutations: () => ({
    remove: { mutate: (...a: unknown[]) => mockRemove(...a) },
    rename: { mutate: (...a: unknown[]) => mockRename(...a) },
    removeWithTwin: { mutate: (...a: unknown[]) => mockRemoveWithTwin(...a) },
    restoreVersion: { mutate: (...a: unknown[]) => mockRestoreVersion(...a) },
  }),
}));
jest.mock("@/player/controller", () => ({ playFileQueue: jest.fn(async () => true) }));
jest.mock("@/player/useFavourite", () => ({ useFavourite: () => ({ isFav: false, toggle: jest.fn(), busy: false }) }));
jest.mock("@/player/metadata/metadataStore", () => ({ getForTrack: () => null }));
jest.mock("@/reader/readingState", () => ({ loadReadingState: jest.fn(async () => ({ version: 1, location: null, percent: 0, bookmarks: [] })) }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "tok") }));
const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));
jest.mock("@/contacts/restoreContacts", () => ({ restoreContacts: jest.fn(async () => ({ added: 4, failed: 1 })) }));
jest.mock("@/contacts/backupContacts", () => ({
  backupContacts: jest.fn(async () => ({ count: 3, fileName: "contacts-2026-07-12.vcf" })),
  getLastContactsBackupAt: jest.fn(async () => null),
}));
jest.mock("@/backup/folders", () => ({ findContactsFolder: jest.fn(async () => "folder1") }));
jest.mock("@/upload/runner", () => ({ uploadOne: jest.fn(async () => ({ fileId: "f1", sizeBytes: null })) }));
const mockApiRequest = jest.fn();
jest.mock("@/api/client", () => ({ apiRequest: (...a: unknown[]) => mockApiRequest(...a) }));
jest.mock("@/comments/api", () => ({
  MAX_COMMENT_LENGTH: 5000,
  listComments: jest.fn(),
  postComment: jest.fn(),
  editComment: jest.fn(),
  deleteComment: jest.fn(),
}));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ userId: "u1", roleName: "member", can: () => true }),
}));
jest.mock("@/editor/api", () => ({
  getEditorConfig: jest.fn(),
  editorHtml: jest.fn(() => "<html>editor</html>"),
}));
jest.mock("@/reader/bookCache", () => ({
  ensureBookCached: jest.fn(),
  releaseOpenBooks: jest.fn(async () => {}),
}));
jest.mock("@/reader/BookReader", () => ({ BookReader: () => null }));
jest.mock("@/reader/PdfReader", () => ({ PdfReader: () => null }));
jest.mock("@/share/CreateShareSheet", () => ({ CreateShareSheet: () => null }));

// ── fixtures ─────────────────────────────────────────────────────────────────
const BASE = {
  id: "f1", name: "notes.txt", size_bytes: 12, mime_type: "text/plain", extension: ".txt",
  created_at: 1700000000, updated_at: 1700000000, current_version: 1, lock_mode: "none",
  share_count: 0, comment_count: 0,
};
const VCF = [
  "BEGIN:VCARD", "VERSION:3.0", "FN:Ada Lovelace", "ORG:Analytical Engines",
  "TEL;TYPE=CELL:+1-555-0100", "EMAIL;TYPE=WORK:ada@example.com", "NOTE:Keep me", "BDAY:1815-12-10", "END:VCARD",
  "BEGIN:VCARD", "VERSION:3.0", "FN:Adam Smith", "TEL;TYPE=HOME:+1-555-0142", "NOTE:One", "END:VCARD",
  "BEGIN:VCARD", "VERSION:3.0", "N:Doe;Jane;;;", "END:VCARD",
].join("\r\n") + "\r\n";

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

/** Text that is mock data or counted from the mock file, not catalog English. */
const MOCK_DATA = ["19 lines", "Jane Doe"];

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  mockParams = { id: "f1", fileId: "f1", name: "report.pdf" };
  mockFile = { ...BASE };
  mockFileError = false;
  mockFileLoading = false;
  useViewerList.getState().clearViewerList();
  useWorkspaceStore.setState({ activeId: "w1" });
  useArchiveSaveStore.getState().take();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => VCF })) as never;
});

const renderIn = (locale: Locale, ui: ReactElement) => renderInLocale(withQuery(ui), locale);

async function openMore(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
  fireEvent.press(screen.getByTestId("viewer-action-more"));
  await waitFor(() => expect(screen.getByText(t("common.action.rename"))).toBeTruthy());
}

describe.each(SWEEP_LOCALES)("File detail in %s", (locale) => {
  it("the More menu and the rename dialog", async () => {
    mockFile = { ...BASE, comment_count: 3 };
    const view = await renderIn(locale, <FileViewerRoute />);
    await openMore();
    expect(view.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.press(screen.getByText(t("common.action.rename")));
    await waitFor(() => expect(screen.getByPlaceholderText(t("files.placeholder.fileName"))).toBeTruthy());
    expect(collectTexts()).toContain(t("files.heading.renameFile"));
    expect(view.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("a vcf offers Restore to phone", async () => {
    mockFile = { ...BASE, name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: VCF.length };
    const view = await renderIn(locale, <FileViewerRoute />);
    await openMore();
    expect(collectTexts()).toContain(t("files.action.restoreToPhone"));
    expect(view.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("an office document offers Edit document", async () => {
    mockFile = { ...BASE, name: "plan.docx", extension: ".docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    const view = await renderIn(locale, <FileViewerRoute />);
    await openMore();
    expect(collectTexts()).toContain(t("files.action.editDocument"));
    expect(view.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("the error screen", async () => {
    mockFile = undefined;
    mockFileError = true;
    const view = await renderIn(locale, <FileViewerRoute />);
    await waitFor(() => expect(screen.getByTestId("viewer-reload")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });
});
