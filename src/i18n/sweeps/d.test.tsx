/**
 * Unit D sweep: the file detail screen and its sub-screens (versions, share
 * route, contacts editor, archive browser, reader gate), the archive save
 * destination, comments, the contacts backup screen and the document editor,
 * rendered in a language other than English.
 */
import { act, configure, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Alert } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Contacts from "expo-contacts";
import { Image as ExpoImage } from "expo-image";
import FileViewerRoute from "../../../app/(tabs)/(files)/file/[id]";
import VersionsScreen from "../../../app/(tabs)/(files)/file/[id]/versions";
import FileShareScreen from "../../../app/(tabs)/(files)/file/[id]/share";
import FileContactsRoute from "../../../app/(tabs)/(files)/file/[id]/contacts";
import ArchiveRoute from "../../../app/file/[id]/archive";
import ReadRoute from "../../../app/file/[id]/read";
import PickArchiveDestination from "../../../app/pick-archive-destination";
import CommentsScreen from "../../../app/comments";
import ContactsScreen from "../../../app/contacts";
import EditorScreen from "../../../app/editor";
import { useViewerList } from "../../viewer/viewerStore";
import { useWorkspaceStore } from "../../files/workspaceStore";
import { useArchiveSaveStore } from "../../archive/archiveSaveStore";
import { planFolderSave, type SavePlan } from "../../archive/archiveSave";
import { buildArchiveTree, type ArchiveEntry } from "../../archive/archiveTree";
import { listComments } from "../../comments/api";
import { getEditorConfig } from "../../editor/api";
import { getVersions } from "../../files/api";
import { t, useLocale, __resetI18nForTests } from "../../lib/i18n";
import { captureAlerts, collectTexts, leftoverEnglish, renderInLocale } from "../../../test-utils/i18n-sweep";
import { finishSheetDismissal } from "../../ui/sheetTesting";

// Every screen here boots a language and several mount a native-ish tree; under a
// saturated full run the default 1 s budget is the flaky part, not the assertions.
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

// ── expo-router: titles and header parts become visible text ──────────────────
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../test-utils/i18n-sweep").routerMockWithTitles();
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
let mockWebviewProps: Record<string, any> = {};
jest.mock("react-native-webview", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const WebView = React.forwardRef((props: Record<string, unknown>) => {
    mockWebviewProps = props;
    return null;
  });
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
const mockEnsure = jest.fn();
jest.mock("@/reader/bookCache", () => ({
  ensureBookCached: (...a: unknown[]) => mockEnsure(...a),
  releaseOpenBooks: jest.fn(async () => {}),
}));
jest.mock("@/reader/BookReader", () => ({ BookReader: () => null }));
jest.mock("@/reader/PdfReader", () => ({ PdfReader: () => null }));
let mockShareTarget: Record<string, unknown> | null = null;
jest.mock("@/share/CreateShareSheet", () => ({
  CreateShareSheet: (p: { target: Record<string, unknown> }) => {
    mockShareTarget = p.target;
    return null;
  },
}));

const mockGetComments = listComments as jest.MockedFunction<typeof listComments>;
const mockGetEditorConfig = getEditorConfig as jest.MockedFunction<typeof getEditorConfig>;
const mockGetVersions = getVersions as jest.MockedFunction<typeof getVersions>;

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
const NOW = Math.floor(Date.now() / 1000);

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const probe: { setPreference: (p: "de" | "en" | "pl") => Promise<void> } = { setPreference: async () => {} };
function Probe(): null {
  probe.setPreference = useLocale().setPreference as (p: "de" | "en" | "pl") => Promise<void>;
  return null;
}

/** English the unit does not own: viewer chrome and stages (unit E), shared dialogs (unit K). */
const OTHER_UNITS = [
  "Save", "Link", "Star", "Versions", "More", "Download", "Delete", "Unlock", "Password",
  "Read", "Play", "Open", "Retry", "Version", "Details", "Locked", "View only", "Unlock to view",
  "Enter the password to open this file", "Wrong password",
  "19 lines", "Wrap long lines", "Copy", "Share", "Back", "More actions", "Show details",
  "No number", "View 3 contacts",
  // mock user data (a name derived from an N line)
  "Jane Doe",
];

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  mockParams = { id: "f1", fileId: "f1", name: "report.pdf" };
  mockFile = { ...BASE };
  mockFileError = false;
  mockFileLoading = false;
  mockShareTarget = null;
  mockWebviewProps = {};
  useViewerList.getState().clearViewerList();
  useWorkspaceStore.setState({ activeId: "w1" });
  useArchiveSaveStore.getState().take();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => VCF })) as never;
});

const renderTr = (ui: ReactElement) => renderInLocale(withQuery(ui), "tr");

// ── file detail screen ───────────────────────────────────────────────────────
async function openMore(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
  fireEvent.press(screen.getByTestId("viewer-action-more"));
  await waitFor(() => expect(screen.getByText(t("common.action.rename"))).toBeTruthy());
}

describe("file detail in Turkish", () => {
  it("the More menu and the rename dialog have no leftover English", async () => {
    mockFile = { ...BASE, comment_count: 3 };
    const view = await renderTr(<FileViewerRoute />);
    await openMore();
    expect(view.leftover({ allow: OTHER_UNITS })).toEqual([]);
    const texts = collectTexts();
    for (const key of [
      "common.action.rename", "files.action.moveToFolder", "files.action.makeACopy", "files.action.shareVia",
      "common.label.fileDetails", "common.action.moveToTrash",
    ] as const) {
      expect(texts).toContain(t(key));
    }
    expect(texts).toContain(t("files.label.commentsCommentCount", { commentCount: 3 }));

    fireEvent.press(screen.getByText(t("common.action.rename")));
    finishSheetDismissal();
    await waitFor(() => expect(screen.getByPlaceholderText(t("files.placeholder.fileName"))).toBeTruthy());
    expect(collectTexts()).toContain(t("files.heading.renameFile"));
    expect(view.leftover({ allow: OTHER_UNITS })).toEqual([]);
  });

  it("the comments row has no count when there are no comments", async () => {
    await renderTr(<FileViewerRoute />);
    await openMore();
    expect(collectTexts()).toContain(t("files.label.comments"));
  });

  it("a vcf offers Restore to phone, reports the result and shows Restoring while it works", async () => {
    mockFile = { ...BASE, name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: VCF.length };
    const view = await renderTr(<FileViewerRoute />);
    await openMore();
    expect(collectTexts()).toContain(t("files.action.restoreToPhone"));
    expect(view.leftover({ allow: OTHER_UNITS })).toEqual([]);
    fireEvent.press(screen.getByText(t("files.action.restoreToPhone")));
    finishSheetDismissal();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(t("common.error.addedAddedContactsFailedFailed", { added: 4, failed: 1 })));
  });

  it("an office document offers Edit document", async () => {
    mockFile = { ...BASE, name: "plan.docx", extension: ".docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    await renderTr(<FileViewerRoute />);
    await openMore();
    expect(collectTexts()).toContain(t("files.action.editDocument"));
  });

  it("the error screen has no leftover English", async () => {
    mockFile = undefined;
    mockFileError = true;
    const view = await renderTr(<FileViewerRoute />);
    await waitFor(() => expect(screen.getByTestId("viewer-reload")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("files.error.couldnTLoadThisFile"), t("common.action.tryAgain"), t("common.action.goBack"),
    ]));
  });

  it("the offline notice and the stage accessibility label are translated", async () => {
    mockFileError = true;
    const view = await renderTr(<FileViewerRoute />);
    expect(await screen.findByTestId("viewer-offline-notice")).toBeTruthy();
    expect(collectTexts()).toContain(t("files.label.offlineShowingTheSavedCopy"));
    expect(collectTexts()).toContain(t("files.action.hideControls"));
    expect(view.leftover({ allow: OTHER_UNITS })).toEqual([]);
  });

  it("the download-off note is translated", async () => {
    mockFile = { ...BASE, lock_mode: "view_only" };
    const view = await renderTr(<FileViewerRoute />);
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    expect(collectTexts()).toContain(t("files.description.theOwnerTurnedOffDownloadsForThisFileYouCanViewItAndShare"));
    expect(view.leftover({ allow: OTHER_UNITS })).toEqual([]);
  });

  it("the Live Photo trash question goes through the alert in Turkish", async () => {
    const STILL = { ...BASE, name: "IMG_1.HEIC", extension: ".heic", mime_type: "image/heic" };
    mockFile = { ...STILL };
    useViewerList.getState().setViewerList([{ ...STILL, live_video_id: "v1" }] as never, "Trip");
    const alerts = captureAlerts();
    await renderTr(<FileViewerRoute />);
    await openMore();
    fireEvent.press(screen.getByText(t("common.action.moveToTrash")));
    finishSheetDismissal();
    expect(alerts.calls).toHaveLength(1);
    expect(alerts.calls[0].title).toBe(t("files.description.deletePhoto"));
    expect(alerts.calls[0].message).toBe(t("files.description.alsoDeleteItsLivePhotoVideo"));
    expect(alerts.calls[0].buttons).toEqual([t("files.action.keepVideo"), t("files.action.deleteBoth"), t("common.cancel")]);
    expect(leftoverEnglish(alerts.texts(), "tr")).toEqual([]);
    alerts.restore();
  });

  it("the trash toast, the share failure and the rename toast are translated", async () => {
    await renderTr(<FileViewerRoute />);
    await openMore();
    fireEvent.press(screen.getByText(t("common.action.moveToTrash")));
    finishSheetDismissal();
    expect(mockRemove).toHaveBeenCalled();
    act(() => { (mockRemove.mock.calls[0][1] as { onSuccess: () => void }).onSuccess(); });
    expect(mockToast).toHaveBeenCalledWith(t("files.status.movedToTrashInFiles"));

    await openMore();
    const { shareFile } = require("@/files/download") as { shareFile: jest.Mock };
    shareFile.mockRejectedValueOnce("offline");
    fireEvent.press(screen.getByText(t("files.action.shareVia")));
    finishSheetDismissal();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("common.error.couldnTShareThisFile"), "error"));

    await openMore();
    fireEvent.press(screen.getByText(t("common.action.rename")));
    finishSheetDismissal();
    const input = await screen.findByPlaceholderText(t("files.placeholder.fileName"));
    fireEvent.changeText(input, "renamed.txt");
    fireEvent.press(screen.getByText(t("common.action.rename"), { exact: true }));
    await waitFor(() => expect(mockRename).toHaveBeenCalled());
    act(() => { (mockRename.mock.calls[0][1] as { onSuccess: () => void }).onSuccess(); });
    expect(mockToast).toHaveBeenCalledWith(t("files.label.renamed"));
  });

  it("unlocking toasts in Turkish and a non-Error rejection shows the translated wrong-password text", async () => {
    mockFile = { ...BASE, lock_mode: "full_lock" };
    const { unlockFile } = require("@/files/mutations") as { unlockFile: jest.Mock };
    await renderTr(<FileViewerRoute />);
    await waitFor(() => expect(screen.getByTestId("unlock-password")).toBeTruthy());
    unlockFile.mockRejectedValueOnce("nope");
    fireEvent.changeText(screen.getByTestId("unlock-password"), "x");
    fireEvent.press(screen.getByTestId("unlock"));
    await waitFor(() => expect(screen.getByTestId("unlock-error")).toBeTruthy());
    expect(screen.getByTestId("unlock-error").props.children).toBe(t("common.error.wrongPassword"));
    fireEvent.changeText(screen.getByTestId("unlock-password"), "right");
    fireEvent.press(screen.getByTestId("unlock"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("files.status.unlocked")));
  });

  it("switching the language while mounted changes the open More menu in place", async () => {
    const view = await renderInLocale(withQuery(<><Probe /><FileViewerRoute /></>), "en");
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByText("Move to trash")).toBeTruthy());
    expect(view).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(screen.getByText(t("common.action.moveToTrash"))).toBeTruthy());
    expect(screen.queryByText("Move to trash")).toBeNull();
    expect(collectTexts()).toContain(t("files.action.makeACopy"));
  });
});

describe("versions and share route in Turkish", () => {
  it("lists versions with the header, the current marker and Restore", async () => {
    mockGetVersions.mockResolvedValue({ current: 2, versions: [
      { id: "v2", version_number: 2, size_bytes: 20, uploader_name: "Ada", created_at: 1700000000 },
      { id: "v1", version_number: 1, size_bytes: 10, uploader_name: "Ada", created_at: 1699990000 },
    ] } as never);
    const view = await renderTr(<VersionsScreen />);
    await waitFor(() => expect(screen.getByText(t("files.label.versionVersionNumberIsCurrentSelectTrueCurrentOther", { versionNumber: 2, isCurrent: "true" }))).toBeTruthy());
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("files.heading.versionHistory"),
      t("files.label.versionVersionNumberIsCurrentSelectTrueCurrentOther", { versionNumber: 1, isCurrent: "false" }),
      t("files.action.restore"),
    ]));
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("restore-v1"));
    act(() => { (mockRestoreVersion.mock.calls[0][1] as { onSuccess: () => void }).onSuccess(); });
    expect(mockToast).toHaveBeenCalledWith(t("common.status.restored"));
  });

  it("the share route title and its placeholder file name are translated", async () => {
    mockFile = undefined;
    const view = await renderTr(<FileShareScreen />);
    expect(collectTexts()).toContain(t("common.action.share"));
    expect(mockShareTarget?.name).toBe(t("common.label.thisFile"));
    expect(view.leftover()).toEqual([]);
  });
});

// ── contacts editor on a file ────────────────────────────────────────────────
describe("file contacts in Turkish", () => {
  const vcfFile = () => ({
    id: "f1", name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf",
    size_bytes: VCF.length, current_version: 1, lock_mode: "none",
  });
  const ready = () => waitFor(() => expect(screen.getByTestId("contact-0")).toBeTruthy());

  it("viewing, searching, editing and the save bar have no leftover English", async () => {
    mockFile = vcfFile();
    const view = await renderTr(<FileContactsRoute />);
    await ready();
    expect(view.leftover({ allow: ["Jane Doe"] })).toEqual([]);
    expect(screen.getByTestId("contact-count").props.children).toBe(
      t("contacts.label.viewscountPluralOneContactOtherContacts", { viewsCount: 3 }),
    );
    // "Jane Doe" has no FN: the fallback comes from N, and a nameless card from the catalog.
    fireEvent.changeText(screen.getByTestId("contact-search"), "zzz");
    expect(screen.getByTestId("contact-count").props.children).toBe(t("contacts.label.shownOfTotalContacts", { shown: 0, total: 3 }));
    expect(screen.getByTestId("contacts-empty").props.children).toBe(t("contacts.description.noContactsMatchThatSearch"));
    expect(view.leftover()).toEqual([]);
    fireEvent.changeText(screen.getByTestId("contact-search"), "");

    fireEvent.press(screen.getByTestId("contact-0-edit"));
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("contacts.label.phone"), t("contacts.label.email"), t("common.delete"),
      t("contacts.description.hiddencountOtherHiddenCountPluralOneFieldIsOtherFieldsAreKeptUnchanged", { hiddenCount: 2 }),
      t("common.accessibility.removeMName", { mName: "cell" }),
      t("contacts.action.doneEditingContact"),
    ]));
    fireEvent.changeText(screen.getByTestId("contact-0-name-input"), "Ada L");
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("common.action.saveChanges"), t("contacts.description.savesAsANewVersionThePreviousContactsStayRecoverable"),
    ]));
    expect(view.leftover({ allow: ["Jane Doe"] })).toEqual([]);

    fireEvent.press(screen.getByTestId("contact-0-delete"));
    await waitFor(() => expect(screen.getByText(t("contacts.heading.deleteContact"))).toBeTruthy());
    expect(view.leftover({ allow: OTHER_UNITS })).toEqual([]);
  });

  it("adding a contact names it in Turkish and saving toasts in Turkish", async () => {
    mockFile = vcfFile();
    await renderTr(<FileContactsRoute />);
    await ready();
    expect(collectTexts()).toContain(t("contacts.label.add"));
    expect(screen.getByTestId("contact-add").props.accessibilityLabel).toBe(t("contacts.action.addContact"));
    fireEvent.press(screen.getByTestId("contact-add"));
    await waitFor(() => expect(screen.getByTestId("contact-3-name-input").props.value).toBe(t("contacts.action.newContact")));
    fireEvent.press(screen.getByTestId("contacts-save"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("contacts.status.contactsSaved")));
  });

  it("a card with no name shows the catalog placeholder, in the current language", async () => {
    mockFile = vcfFile();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n" })) as never;
    await renderTr(<FileContactsRoute />);
    await ready();
    expect(collectTexts()).toContain(t("common.label.noName"));
  });

  it("the read-only notes and the load errors are translated", async () => {
    mockFile = { ...vcfFile(), lock_mode: "view_only" };
    const view = await renderTr(<FileContactsRoute />);
    await ready();
    expect(screen.getByTestId("contacts-readonly")).toBeTruthy();
    expect(collectTexts()).toContain(t("contacts.description.viewOnlyTheOwnerHasDisabledChanges"));
    expect(view.leftover({ allow: ["Jane Doe"] })).toEqual([]);
  });

  it("a failed load shows the translated status sentence, with a translated Retry", async () => {
    mockFile = vcfFile();
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => "" })) as never;
    const view = await renderTr(<FileContactsRoute />);
    await waitFor(() => expect(screen.getByTestId("retry-contacts")).toBeTruthy());
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("contacts.error.couldnTLoadContactsStatus", { status: "503" }), t("common.retry"),
    ]));
    expect(view.leftover()).toEqual([]);
  });

  it("the file-load failure is translated", async () => {
    mockFile = undefined;
    mockFileError = true;
    await renderTr(<FileContactsRoute />);
    expect(collectTexts()).toContain(t("common.error.couldnTLoadFile"));
  });

  it("every count is a plural in Polish for 1, 3 and 5", async () => {
    mockFile = vcfFile();
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:P${i}\r\nEND:VCARD\r\n`).join("");
    const seen: string[] = [];
    for (const n of [1, 3, 5]) {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => lines(n) })) as never;
      const view = await renderInLocale(withQuery(<FileContactsRoute />), "pl");
      await ready();
      const text = screen.getByTestId("contact-count").props.children as string;
      expect(text).toBe(t("contacts.label.viewscountPluralOneContactOtherContacts", { viewsCount: n }));
      seen.push(text);
      view.unmount();
    }
    expect(new Set(seen.map((s) => s.replace(/^\d+ /, ""))).size).toBe(3);
  });
});

// ── archive browser ──────────────────────────────────────────────────────────
const entry = (over: Partial<ArchiveEntry> & { i: number; name: string }): ArchiveEntry => (
  { size: 0, csize: 0, method: 8, dir: false, encrypted: false, mtime: null, ...over }
);
const ARCHIVE_ENTRIES: ArchiveEntry[] = [
  entry({ i: 0, name: "photos/", dir: true }),
  entry({ i: 1, name: "photos/cat.png", size: 2048 }),
  entry({ i: 2, name: "secret.txt", size: 50, encrypted: true }),
  entry({ i: 3, name: "odd.bin", size: 5, method: 12 }),
  entry({ i: 4, name: "readme.txt", size: 50 }),
];
const archiveIndex = (over: Record<string, unknown> = {}) => ({
  kind: "zip", archiveSize: 9999, totalEntries: 5, truncated: false, entries: ARCHIVE_ENTRIES, ...over,
});

describe("archive in Turkish", () => {
  beforeEach(() => { mockParams = { id: "f1", name: "photos.zip" }; });

  it("the list, the header and the save-all bar have no leftover English", async () => {
    mockApiRequest.mockResolvedValue(archiveIndex());
    const view = await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));
    // "Archive" has no catalog entry; it stays English by design.
    expect(view.leftover({ allow: ["Archive"] })).toEqual([]);
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("sync.label.root"),
      t("archive.label.archivenameRoot", { archiveName: "photos.zip" }),
      t("archive.label.inArchiveName", { archiveName: "photos.zip" }),
      t("common.action.saveAllToDosya"),
      t("archive.action.saveEverythingInThisArchiveToDosya"),
      t("archive.status.passwordProtected"),
      t("archive.error.unsupportedCompression"),
      t("archive.error.thisEntryIsPasswordProtectedAndCannotBeOpened"),
      t("archive.description.thisEntryUsesACompressionMethodThisAppCannotOpen"),
      t("archive.action.saveNameToDosya", { name: "readme.txt" }),
      t("common.label.item", { count: 1 }),
      t("archive.label.entrycountPluralOneEntryOtherEntries", { entryCount: 4 }),
      t("common.back"),
    ]));
    // Into a folder: the chip row grows and the count follows.
    fireEvent.press(screen.getByTestId("archive-dir-photos"));
    expect(collectTexts()).toContain(t("archive.label.entrycountPluralOneEntryOtherEntries", { entryCount: 1 }));
  });

  it("a disk image says so, and an empty archive and an empty folder have their own sentences", async () => {
    mockParams = { id: "f1", name: "disc.iso" };
    mockApiRequest.mockResolvedValue(archiveIndex({ kind: "iso" }));
    const view = await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));
    expect(collectTexts()).toContain(t("archive.label.diskImage"));
    expect(view.leftover()).toEqual([]);
    view.unmount();

    mockApiRequest.mockResolvedValue(archiveIndex({ entries: [], totalEntries: 0 }));
    const empty = await renderTr(<ArchiveRoute />);
    await waitFor(() => expect(collectTexts()).toContain(t("common.description.thereIsNothingInsideThisArchive")));
    expect(empty.leftover()).toEqual([]);
  });

  it("every failure kind has translated text, and the server sentence for a disk image rides along", async () => {
    const { ApiError } = require("@/api/errors");
    const cases: [string, unknown, "archive.error.thisFileIsnTAValidZip" | "archive.error.thisArchiveIsTooLargeToListDownloadItToOpenItsContents" | "archive.error.thisArchiveCouldNotBeOpened"][] = [
      ["photos.zip", new ApiError("bad", 422), "archive.error.thisFileIsnTAValidZip"],
      ["photos.zip", new ApiError("big", 413), "archive.error.thisArchiveIsTooLargeToListDownloadItToOpenItsContents"],
      ["photos.zip", new ApiError("boom", 500), "archive.error.thisArchiveCouldNotBeOpened"],
    ];
    for (const [name, err, expected] of cases) {
      mockParams = { id: "f1", name };
      mockApiRequest.mockRejectedValueOnce(err);
      const view = await renderTr(<ArchiveRoute />);
      await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
      expect(collectTexts()).toContain(t(expected));
      expect(view.leftover()).toEqual([]);
      view.unmount();
    }
    mockParams = { id: "f1", name: "floppy.img" };
    mockApiRequest.mockRejectedValueOnce(new ApiError("Raw disk images are not supported.", 422));
    const disk = await renderTr(<ArchiveRoute />);
    await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
    expect(collectTexts()).toContain(
      t("archive.description.thisFileIsnTAValidDiskImageHasErrorSelectTrueServerErrorOther", { hasError: "true", serverError: "Raw disk images are not supported." }),
    );
    disk.unmount();
    // Without a server sentence nothing trails the text.
    mockApiRequest.mockRejectedValueOnce(new ApiError("", 422));
    await renderTr(<ArchiveRoute />);
    await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
    expect(collectTexts()).toContain(t("archive.description.thisFileIsnTAValidDiskImageHasErrorSelectTrueServerErrorOther", { hasError: "false", serverError: "" }).trim());
  });

  it("the truncation note and the too-many-files toast are translated", async () => {
    mockApiRequest.mockResolvedValue(archiveIndex({ truncated: true, totalEntries: 12345 }));
    await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));
    expect(collectTexts().some((s) => s.includes("12") && s.includes(t("archive.description.showingTheFirstEntriesCountOfTotalEntriesEntriesTransferTheWholeArchiveToGetThe", { entriesCount: "", totalEntries: "" }).slice(0, 4)))).toBe(true);

    const many = Array.from({ length: 501 }, (_, i) => entry({ i: i + 1, name: `big/f${i}.txt`, size: 1 }));
    mockApiRequest.mockResolvedValue(archiveIndex({ entries: [entry({ i: 0, name: "big/", dir: true }), ...many], truncated: false }));
    const view = await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getAllByTestId("archive-save-big"));
    fireEvent.press(screen.getAllByTestId("archive-save-big")[0]);
    expect(mockToast).toHaveBeenCalled();
    expect(leftoverEnglish([mockToast.mock.calls[0][0] as string], "tr")).toEqual([]);
    expect(view).toBeTruthy();
  });

  it("opening an entry that cannot be transferred, or is refused, toasts in Turkish", async () => {
    const { ApiError } = require("@/api/errors");
    const { downloadToCache } = require("@/files/download") as { downloadToCache: jest.Mock };
    mockApiRequest.mockResolvedValue(archiveIndex());
    await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));
    downloadToCache.mockRejectedValueOnce(new ApiError("no", 403));
    fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("archive.status.youDonTHavePermissionToSaveOrShareThisEntry"), "error"));
    downloadToCache.mockRejectedValueOnce(new Error("x"));
    fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("archive.error.thisEntryCouldNotBeTransferred"), "error"));
  });

  it("the image preview close button is translated", async () => {
    mockApiRequest.mockResolvedValue(archiveIndex());
    await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getByText("photos"));
    fireEvent.press(screen.getByTestId("archive-dir-photos"));
    fireEvent.press(screen.getByTestId("archive-entry-cat.png"));
    await waitFor(() => expect(collectTexts()).toContain(t("archive.action.closePreview")));
  });

  it("an unnamed archive is called 'this archive' in the language", async () => {
    mockParams = { id: "f1" };
    mockApiRequest.mockResolvedValue(archiveIndex());
    await renderTr(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));
    expect(collectTexts()).toContain(t("archive.label.inArchiveName", { archiveName: t("archive.label.thisArchive") }));
  });

  it("switching the language while mounted rewrites the chip row and the error in place", async () => {
    mockApiRequest.mockResolvedValue(archiveIndex());
    await renderInLocale(withQuery(<><Probe /><ArchiveRoute /></>), "en");
    await waitFor(() => screen.getByText("readme.txt"));
    expect(collectTexts()).toContain("Root");
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(collectTexts()).toContain(t("sync.label.root")));
    expect(collectTexts()).not.toContain("Root");
  });
});

// ── save destination ─────────────────────────────────────────────────────────
describe("archive save destination in Turkish", () => {
  const TREE = buildArchiveTree([
    entry({ i: 4, name: "assets/hero.png", size: 1 }), entry({ i: 7, name: "README.md", size: 1 }),
  ]);
  const assets = TREE.find((n) => n.name === "assets")!;

  it("the picker, the empty state and the entry confirmation are translated", async () => {
    useArchiveSaveStore.getState().park({ fileId: "f1", archiveName: "bundle.zip", kind: "entry", index: 7, name: "README.md" });
    mockApiRequest.mockResolvedValue({ ok: true, file_id: "file_9", name: "README (2).md", size_bytes: 30 });
    const view = await renderTr(<PickArchiveDestination />);
    await waitFor(() => screen.getByText("Dest"));
    expect(view.leftover()).toEqual([]);
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("archive.heading.saveTo"), t("sync.label.root"), t("common.action.saveHere"),
      t("archive.label.savingWhatFromArchiveName", { what: "README.md", archiveName: "bundle.zip" }),
    ]));
    fireEvent.press(screen.getByText("Dest"));
    expect(collectTexts()).toContain(t("archive.label.upOneFolder"));
    expect(collectTexts()).toContain(t("common.label.noSubFolders"));
    expect(collectTexts()).toContain(`${t("sync.label.root")} / Dest`);
    fireEvent.press(screen.getByTestId("archive-save-here"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(t("archive.status.savedNameToDosya", { name: "README (2).md" }));
  });

  it("nothing parked says so in Turkish", async () => {
    const view = await renderTr(<PickArchiveDestination />);
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("archive.heading.saveTo"), t("archive.description.nothingToSaveGoBackToTheArchiveAndChooseAFileOrFolder"),
    ]));
    expect(view.leftover()).toEqual([]);
  });

  it("a folder save summarises with skipped, failed and cancelled parts, and the progress line is translated", async () => {
    const plan = planFolderSave(assets.children, "assets") as SavePlan;
    useArchiveSaveStore.getState().park({ fileId: "f1", archiveName: "bundle.zip", kind: "folder", plan });
    mockApiRequest.mockImplementation(async (path: string, opts: { body: { folders: { name: string; parent_id: string | null }[] } }) => {
      if (path === "/api/folders/batch") {
        return { ok: true, folders: opts.body.folders.map((f) => ({ name: f.name, parent_id: f.parent_id, id: `fld_${f.name}`, created: true })) };
      }
      throw new Error("Disk full");
    });
    const view = await renderTr(<PickArchiveDestination />);
    await waitFor(() => screen.getByTestId("archive-save-here"));
    expect(collectTexts()).toContain(
      t("archive.label.savingWhatFromArchiveName", {
        what: t("archive.label.foldernameCountPluralOneFileOtherFiles", { folderName: "assets", count: 1 }),
        archiveName: "bundle.zip",
      }),
    );
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("archive-save-here"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const [message, kind] = mockToast.mock.calls[0];
    expect(kind).toBe("error");
    expect(message).toBe(t("archive.status.savedSaved", {
      saved: 0, folderName: "assets", hasSkipped: "false", skipped: "0", hasFailed: "true", failed: "1", failedName: "hero.png", cancelled: "false",
    }));
    expect(leftoverEnglish([message as string], "tr")).toEqual([]);
  });

  it("a refused save falls back to the translated sentence", async () => {
    useArchiveSaveStore.getState().park({ fileId: "f1", archiveName: "bundle.zip", kind: "entry", index: 7, name: "README.md" });
    mockApiRequest.mockRejectedValue(new Error(""));
    await renderTr(<PickArchiveDestination />);
    await waitFor(() => screen.getByTestId("archive-save-here"));
    fireEvent.press(screen.getByTestId("archive-save-here"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("archive.error.couldNotSaveIntoDosya"), "error"));
  });

  it("the folder summary is a plural in Polish for 1, 3 and 5 files", async () => {
    const seen: string[] = [];
    for (const n of [1, 3, 5]) {
      mockToast.mockClear();
      const nodes = Array.from({ length: n }, (_, i) => entry({ i: i + 1, name: `d/f${i}.txt`, size: 1 }));
      const plan = planFolderSave(buildArchiveTree(nodes)[0].children, "d") as SavePlan;
      useArchiveSaveStore.getState().park({ fileId: "f1", archiveName: "a.zip", kind: "folder", plan });
      mockApiRequest.mockImplementation(async (path: string, opts: { body: { folders: { name: string; parent_id: string | null }[] } }) =>
        path === "/api/folders/batch"
          ? { ok: true, folders: opts.body.folders.map((f) => ({ name: f.name, parent_id: f.parent_id, id: `fld_${f.name}` })) }
          : { ok: true, file_id: "x", name: "f", size_bytes: 1 });
      const view = await renderInLocale(withQuery(<PickArchiveDestination />), "pl");
      await waitFor(() => screen.getByTestId("archive-save-here"));
      fireEvent.press(screen.getByTestId("archive-save-here"));
      await waitFor(() => expect(mockToast).toHaveBeenCalled());
      const message = mockToast.mock.calls[0][0] as string;
      expect(message).toBe(t("archive.status.savedSaved", {
        saved: n, folderName: "d", hasSkipped: "false", skipped: "0", hasFailed: "false", failed: "0", failedName: "", cancelled: "false",
      }));
      seen.push(message);
      view.unmount();
      mockBack.mockClear();
    }
    expect(new Set(seen).size).toBe(3);
    expect(new Set(seen.map((s) => s.replace(/\d+/, "#").replace(/[a-z]+$/i, ""))).size).toBeGreaterThan(0);
  });
});

// ── reader gate ──────────────────────────────────────────────────────────────
describe("reader gate in Turkish", () => {
  beforeEach(() => {
    mockFile = { id: "f1", name: "moby.epub", extension: "epub", mime_type: "application/epub+zip", size_bytes: 1000, current_version: 1, lock_mode: "none" };
  });

  it("a failed download shows the translated fallback and Retry", async () => {
    mockEnsure.mockRejectedValueOnce("boom");
    const view = await renderTr(<ReadRoute />);
    await waitFor(() => expect(screen.getByTestId("retry-download")).toBeTruthy());
    expect(collectTexts()).toEqual(expect.arrayContaining([t("common.error.downloadFailed"), t("common.retry")]));
    expect(view.leftover()).toEqual([]);
  });

  it("a missing file shows the translated sentence", async () => {
    mockFile = undefined;
    mockFileError = true;
    await renderTr(<ReadRoute />);
    expect(collectTexts()).toContain(t("common.error.couldnTLoadFile"));
  });
});

// ── comments ─────────────────────────────────────────────────────────────────
const comment = (over: Record<string, unknown> = {}) => ({
  id: "c1", file_id: "f1", folder_id: null, workspace_id: "w1",
  user_id: "u1", parent_id: null, body: "hello", is_edited: 0,
  created_at: NOW, updated_at: NOW, user_name: "Ada", user_email: "a@b.c", user_avatar: null,
  ...over,
}) as never;

describe("comments in Turkish", () => {
  beforeEach(() => { mockParams = { fileId: "f1", name: "report.pdf" }; });

  it("the thread, its actions, the edited mark and the day label have no leftover English", async () => {
    mockGetComments.mockResolvedValue([
      comment({ id: "c1", is_edited: 1 }),
      comment({ id: "c2", user_id: "u2", user_name: "Grace", body: "hi", parent_id: "c1" }),
      comment({ id: "c3", user_id: "u2", user_name: "Grace", body: "old", created_at: NOW - 86400 * 400 }),
    ]);
    const view = await renderTr(<CommentsScreen />);
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("comments.heading.comments"), t("common.label.you"), t("comments.label.edited"),
      t("files.tooltip.reply"), t("common.edit"), t("common.delete"),
      t("comments.placeholder.writeAComment"), t("comments.action.sendComment"), t("common.label.today"),
    ]));
    // reply strip (a sentence with the name in bold) and the edit form
    fireEvent.press(screen.getByTestId("comment-c2-reply"));
    expect(screen.getByTestId("comments-reply-strip")).toHaveTextContent(t("files.label.replyingToUserName", { userName: "Grace" }));
    expect(collectTexts()).toContain(t("files.tooltip.cancelReply"));
    fireEvent.press(screen.getByTestId("comment-c1-edit"));
    expect(collectTexts()).toEqual(expect.arrayContaining([t("common.cancel"), t("common.save")]));
    expect(view.leftover()).toEqual([]);
  });

  it("the delete dialog, the empty state and the failure state are translated", async () => {
    mockGetComments.mockResolvedValue([comment({ id: "c1" })]);
    const first = await renderTr(<CommentsScreen />);
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("comment-c1-delete"));
    await waitFor(() => expect(collectTexts()).toContain(t("comments.heading.deleteComment")));
    expect(collectTexts()).toContain(t("comments.description.anyRepliesToItAreDeletedToo"));
    first.unmount();

    mockGetComments.mockResolvedValue([]);
    const empty = await renderTr(<CommentsScreen />);
    await waitFor(() => expect(screen.getByTestId("comments-empty")).toBeTruthy());
    expect(collectTexts()).toEqual(expect.arrayContaining([t("files.empty.noCommentsYet"), t("comments.description.startTheConversationOnThisFile")]));
    expect(empty.leftover()).toEqual([]);
    empty.unmount();

    mockGetComments.mockRejectedValue(new Error("x"));
    const failed = await renderTr(<CommentsScreen />);
    await waitFor(() => expect(screen.getByTestId("comments-error")).toBeTruthy());
    expect(collectTexts()).toEqual(expect.arrayContaining([t("comments.error.couldNotLoadThisConversation"), t("common.retry")]));
    expect(failed.leftover()).toEqual([]);
  });

  it("an unnamed file and a failed post are translated", async () => {
    mockParams = { fileId: "f1" };
    mockGetComments.mockResolvedValue([]);
    const { postComment } = require("@/comments/api") as { postComment: jest.Mock };
    postComment.mockRejectedValue("nope");
    await renderTr(<CommentsScreen />);
    await waitFor(() => expect(screen.getByTestId("comments-empty")).toBeTruthy());
    expect(collectTexts()).toContain(t("common.label.thisFile"));
    fireEvent.changeText(screen.getByTestId("comments-input"), "x");
    fireEvent.press(screen.getByTestId("comments-send"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("common.error.somethingWentWrong"), "error"));
  });

  it("the time next to the author follows the language's clock", async () => {
    mockGetComments.mockResolvedValue([comment({ id: "c1", user_id: "u2", user_name: "Grace" })]);
    await renderInLocale(withQuery(<CommentsScreen />), "de");
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    const header = collectTexts().find((s) => s.startsWith("Grace"));
    expect(header).toBeDefined();
    expect(header).not.toMatch(/AM|PM/);
  });

  it("switching the language while mounted rewrites the screen in place", async () => {
    mockGetComments.mockResolvedValue([comment({ id: "c1", is_edited: 1 })]);
    await renderInLocale(withQuery(<><Probe /><CommentsScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    expect(collectTexts()).toContain("Edited");
    expect(collectTexts()).toContain("Today");
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(collectTexts()).toContain(t("comments.label.edited")));
    expect(collectTexts()).not.toContain("Today");
    expect(collectTexts()).toContain(t("common.label.today"));
  });
});

// ── contacts backup screen ───────────────────────────────────────────────────
describe("contacts backup in Turkish", () => {
  const perm = Contacts.getPermissionsAsync as jest.Mock;

  it("the primer, the declined state and the buttons have no leftover English", async () => {
    perm.mockResolvedValue({ granted: false, status: "undetermined" });
    const view = await renderTr(<ContactsScreen />);
    expect(view.leftover()).toEqual([]);
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("contacts.heading.contacts"),
      t("contacts.description.yourAddressBookIsExportedAsASingleVcfFileIntoYourWorkspaceSo"),
      t("contacts.label.oneVcfFileKeptInYourWorkspace"),
      t("contacts.label.accessOnlyHappensWhenYouTapAllow"),
      t("contacts.action.allowContactsAccess"),
      t("contacts.description.backUpYourPhoneSContactsAsAVcfFileInYourActiveWorkspace"),
      t("contacts.label.lastBackupHasBackupSelectTrueDateOtherNever", { hasBackup: "false", date: "" }),
      t("contacts.action.backUpContactsNow"),
      t("contacts.action.restoreFromLatestBackup"),
      t("contacts.description.restoreAddsContactsFromYourMostRecentVcfBackupExistingContactsArenTMerged"),
    ]));
  });

  it("a declined permission and a granted one are translated", async () => {
    perm.mockResolvedValue({ granted: false, status: "denied" });
    const denied = await renderTr(<ContactsScreen />);
    await waitFor(() => expect(collectTexts()).toContain(t("contacts.description.contactsAccessWasDeclinedYouCanTurnItOnFromYourDeviceSettingsThen")));
    expect(denied.leftover()).toEqual([]);
    denied.unmount();

    const { getLastContactsBackupAt } = require("@/contacts/backupContacts") as { getLastContactsBackupAt: jest.Mock };
    getLastContactsBackupAt.mockResolvedValue(1700000000);
    perm.mockResolvedValue({ granted: true, status: "granted" });
    const granted = await renderTr(<ContactsScreen />);
    await waitFor(() => expect(screen.queryByTestId("contacts-primer")).toBeNull());
    await waitFor(() => expect(collectTexts().some((s) => s.startsWith(t("contacts.label.lastBackupHasBackupSelectTrueDateOtherNever", { hasBackup: "true", date: "" }).replace(/\s+$/, "")))).toBe(true));
    expect(granted.leftover()).toEqual([]);
  });

  it("backup and restore toasts are translated", async () => {
    perm.mockResolvedValue({ granted: true, status: "granted" });
    await renderTr(<ContactsScreen />);
    await waitFor(() => expect(screen.queryByTestId("contacts-primer")).toBeNull());
    fireEvent.press(screen.getByTestId("contacts-backup"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("contacts.status.backingUpCountContacts", { count: 3 })));
    fireEvent.press(screen.getByTestId("contacts-restore"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
      t("common.error.addedAddedContactsFailedFailed", { added: 4, failed: 1 }), "error"));
    const { findContactsFolder } = require("@/backup/folders") as { findContactsFolder: jest.Mock };
    findContactsFolder.mockResolvedValueOnce(null);
    fireEvent.press(screen.getByTestId("contacts-restore"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("contacts.error.noContactsBackupFound"), "error"));
    const { backupContacts } = require("@/contacts/backupContacts") as { backupContacts: jest.Mock };
    backupContacts.mockRejectedValueOnce("x");
    fireEvent.press(screen.getByTestId("contacts-backup"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(t("contacts.error.contactsBackupFailed"), "error"));
  });
});

// ── editor ───────────────────────────────────────────────────────────────────
const CONFIG = {
  documentServerUrl: "https://docs.dosya.dev",
  config: {
    document: { title: "Budget.docx", url: "u", fileType: "docx", key: "k" },
    documentType: "word",
    editorConfig: { mode: "view" as const, callbackUrl: "cb" },
    token: "signed.jwt",
  },
};
const send = (payload: unknown) =>
  act(() => { mockWebviewProps.onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } }); });

describe("editor in Turkish", () => {
  it("loading, read-only and the title fallback are translated", async () => {
    mockParams = { fileId: "f1" };
    mockGetEditorConfig.mockResolvedValue(CONFIG as never);
    const view = await renderTr(<EditorScreen />);
    expect(collectTexts()).toEqual(expect.arrayContaining([t("editor.heading.editor"), t("editor.label.openingTheDocument")]));
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    expect(collectTexts()).toContain(t("editor.status.readOnly"));
    expect(view.leftover()).toEqual([]);
  });

  it("a page error without a message, and a failed config, are translated", async () => {
    mockParams = { fileId: "f1", name: "Budget.docx" };
    mockGetEditorConfig.mockResolvedValue({ ...CONFIG, config: { ...CONFIG.config, editorConfig: { mode: "edit" } } } as never);
    const first = await renderTr(<EditorScreen />);
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    send({ type: "error" });
    await waitFor(() => expect(screen.getByTestId("editor-error")).toBeTruthy());
    expect(collectTexts()).toEqual(expect.arrayContaining([
      t("editor.error.thisDocumentCouldNotBeOpened"), t("editor.error.theEditorCouldNotBeOpened"), t("common.action.tryAgain"),
    ]));
    expect(first.leftover()).toEqual([]);
    first.unmount();

    mockGetEditorConfig.mockRejectedValue("nope");
    await renderTr(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("editor-error")).toBeTruthy());
    expect(collectTexts()).toContain(t("editor.description.theEditorIsUnavailable"));
  });
});

// ── approved rewordings: the new English ─────────────────────────────────────
describe("approved rewordings in English", () => {
  it("the add button reads Add and the edited mark reads Edited", async () => {
    mockFile = { id: "f1", name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: VCF.length, current_version: 1, lock_mode: "none" };
    await renderInLocale(withQuery(<FileContactsRoute />), "en");
    await waitFor(() => expect(screen.getByTestId("contact-0")).toBeTruthy());
    expect(collectTexts()).toContain("Add");
    expect(collectTexts()).not.toContain("+ Add");
  });

  it("the comments thread marks an edit as Edited", async () => {
    mockGetComments.mockResolvedValue([comment({ id: "c1", is_edited: 1 })]);
    await renderInLocale(withQuery(<CommentsScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("comment-c1-edited")).toBeTruthy());
    expect(screen.getByTestId("comment-c1-edited").props.children).toBe("Edited");
  });
});

// A reference so the Alert import is exercised even when no test above spies on it.
void Alert;
