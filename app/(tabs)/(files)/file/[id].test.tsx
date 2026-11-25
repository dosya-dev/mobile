import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Dimensions } from "react-native";
import { __setLayoutRtlForTests } from "@/lib/direction";

// expo-video has no JS implementation under jest-expo; the Live Photo stage
// mounts a VideoView the moment a still turns out to have a twin.
const mockPlayer = { play: jest.fn(), pause: jest.fn(), currentTime: 0, muted: false, loop: false, addListener: jest.fn(() => ({ remove: jest.fn() })) };
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn((_src: unknown, setup?: (p: unknown) => void) => { setup?.(mockPlayer); return mockPlayer; }),
  VideoView: (props: { testID?: string }) => { const { View } = require("react-native"); return <View testID={props.testID ?? "video-view"} />; },
}));

import FileViewerRoute from "./[id]";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { useViewerList } from "@/viewer/viewerStore";
import { useCastStore } from "@/cast/castStore";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { id: "f1" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, back: mockBack }),
  Stack: { Screen: () => null },
}));

let mockFile: Record<string, unknown> = {};
const BASE = {
  id: "f1", name: "notes.txt", size_bytes: 12, mime_type: "text/plain", extension: ".txt",
  created_at: 1700000000, updated_at: 1700000000, current_version: 1, lock_mode: "none",
  share_count: 0, comment_count: 0,
};

const mockRefetch = jest.fn();
let mockFileError = false;
let mockFileErrorObj: unknown = null;
jest.mock("@/files/hooks", () => ({
  useFile: () => ({ data: mockFile, isLoading: false, isError: mockFileError, error: mockFileErrorObj, refetch: mockRefetch }),
  useWorkspaces: () => ({ data: [{ id: "w1", name: "Workspace 1" }] }),
  useRegions: () => ({ data: [{ code: "apac", city: "Sydney", country: "AU", continent: "OC", flag: "AU" }] }),
}));
jest.mock("@/files/api", () => ({ getDownloadUrl: jest.fn(async () => "https://r2/x") }));
// Offline files: no saved copy and an unknown connection unless a test says so.
jest.mock("@/offline/read", () => ({
  ...jest.requireActual("@/offline/read"),
  savedCopy: jest.fn(async () => null),
  savedOriginalForExport: jest.fn(async () => null),
}));
const mockOnline = { value: null as boolean | null };
jest.mock("@/offline/network", () => ({ useIsOnline: () => mockOnline.value, isOnlineNow: () => mockOnline.value }));
jest.mock("@/files/download", () => ({
  downloadToCache: jest.fn(async () => "file:///cache/c.vcf"),
  shareFile: jest.fn(),
}));
jest.mock("@/contacts/restoreContacts", () => ({ restoreContacts: jest.fn(async () => ({ added: 4, failed: 0 })) }));
jest.mock("@/player/controller", () => ({ playFileQueue: jest.fn(async () => true), pauseIfPlaying: jest.fn(async () => {}) }));
jest.mock("@/files/mutations", () => ({ unlockFile: jest.fn(async () => "tok_1") }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "tok") }));
jest.mock("@/player/metadata/metadataStore", () => ({ getForTrack: () => null }));
jest.mock("@/reader/readingState", () => ({ loadReadingState: jest.fn(async () => ({ version: 1, location: null, percent: 0, bookmarks: [] })) }));

const mockRemove = jest.fn();
const mockRename = jest.fn();
const mockRemoveWithTwin = jest.fn();
jest.mock("@/files/mutationHooks", () => ({
  useFileMutations: () => ({
    remove: { mutate: mockRemove },
    rename: { mutate: mockRename },
    removeWithTwin: { mutate: mockRemoveWithTwin },
  }),
}));

const mockToggleFav = jest.fn();
let mockIsFav = false;
jest.mock("@/player/useFavourite", () => ({
  useFavourite: () => ({ isFav: mockIsFav, toggle: mockToggleFav, busy: false }),
}));

const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

// A fake Cast SDK, switched on only by the casting tests: everywhere else
// googleCast() is null, as it is in a binary without the SDK.
const mockLoadMedia = jest.fn(async () => {});
const mockStartSession = jest.fn(async (_id: string) => true);
const mockEndSession = jest.fn(async (_stop: boolean) => {});
const mockCast = { on: false, session: null as unknown };
const mockGoogleCast = {
  CastContext: {
    getPlayServicesState: async () => null,
    showExpandedControls: jest.fn(async () => true),
    discoveryManager: {
      getDevices: async () => [{ deviceId: "tv1", friendlyName: "Living Room TV", modelName: "Chromecast" }],
      onDevicesUpdated: () => ({ remove: () => {} }),
      startDiscovery: async () => {},
      stopDiscovery: async () => {},
    },
    sessionManager: {
      onSessionStarting: () => ({ remove: () => {} }),
      onSessionResuming: () => ({ remove: () => {} }),
      onSessionStarted: () => ({ remove: () => {} }),
      onSessionResumed: () => ({ remove: () => {} }),
      onSessionStartFailed: () => ({ remove: () => {} }),
      onSessionEnded: () => ({ remove: () => {} }),
      getCurrentCastSession: async () => mockCast.session,
      startSession: (id: string) => mockStartSession(id),
      endCurrentSession: (stop: boolean) => mockEndSession(stop),
    },
  },
};
jest.mock("@/cast/native", () => ({ googleCast: () => (mockCast.on ? mockGoogleCast : null) }));

const renderViewer = () => render(<FileViewerRoute />);

/** Drive the inline password gate the way a person would. */
async function unlock(password = "hunter2") {
  await waitFor(() => expect(screen.getByTestId("unlock-password")).toBeTruthy());
  fireEvent.changeText(screen.getByTestId("unlock-password"), password);
  fireEvent.press(screen.getByTestId("unlock"));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Unlocked"));
}

const isDisabled = (id: string) =>
  screen.getByTestId(id).props.accessibilityState?.disabled === true;

describe("file viewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFav = false;
    mockFile = { ...BASE };
    useViewerList.getState().clearViewerList();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "hello" })) as never;
  });

  it("names the file once, in the sheet, and lists its facts", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
    // The old screen printed the filename in the native header AND as an H1.
    expect(screen.getAllByText("notes.txt")).toHaveLength(1);
    expect(screen.getByTestId("viewer-meta").props.children).toContain("12 B");
  });

  it("puts all five actions within reach of the open file", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-actions")).toBeTruthy());
    for (const key of ["save", "link", "star", "versions", "more"]) {
      expect(screen.getByTestId(`viewer-action-${key}`)).toBeTruthy();
    }
  });

  it("routes Link and Versions to their own screens", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-link")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-link"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/share", params: { id: "f1" } });
    fireEvent.press(screen.getByTestId("viewer-action-versions"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/versions", params: { id: "f1" } });
  });

  // ── lock modes ────────────────────────────────────────────────────────────

  it("gates a full_lock file behind a password field on the stage", async () => {
    mockFile = { ...BASE, lock_mode: "full_lock" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("unlock-password")).toBeTruthy());
    expect(screen.getByTestId("viewer-badge")).toBeTruthy();
    expect(isDisabled("viewer-action-save")).toBe(true);
    expect(isDisabled("viewer-action-versions")).toBe(true);
  });

  // A view-only file is READABLE - the owner disabled downloads, not viewing.
  // Mobile once gated it exactly like full_lock, which left it stuck behind a
  // "This file is locked." panel with no way past.
  it("previews a view-only file instead of gating it", async () => {
    mockFile = { ...BASE, lock_mode: "view_only" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
    expect(screen.queryByTestId("unlock-password")).toBeNull();
  });

  it("disables only Save for a view-only file, and says why", async () => {
    mockFile = { ...BASE, lock_mode: "view_only" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-note")).toBeTruthy());
    expect(isDisabled("viewer-action-save")).toBe(true);
    expect(isDisabled("viewer-action-link")).toBe(false);
  });

  it("never presigns a view-only file - download-url 403s it before presigning", async () => {
    const { getDownloadUrl } = require("@/files/api");
    mockFile = { ...BASE, lock_mode: "view_only" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  // ── contacts ──────────────────────────────────────────────────────────────

  const VCF = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:Adam\r\nEND:VCARD\r\n";

  it("peeks at a .vcf instead of dumping its source", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => VCF })) as never;
    mockFile = { ...BASE, name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: VCF.length };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("contact-peek-0")).toBeTruthy());
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByText(/BEGIN:VCARD/)).toBeNull();
  });

  it("counts the contacts in the primary action and routes to them", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => VCF })) as never;
    mockFile = { ...BASE, name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: VCF.length };
    renderViewer();
    await waitFor(() => expect(screen.getByText("View 2 contacts")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-primary"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/contacts", params: { id: "f1" } });
  });

  it("keeps the plain-text stage for a .vcf too large to parse", async () => {
    mockFile = { ...BASE, name: "huge.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: 20 * 1024 * 1024 };
    renderViewer();
    await waitFor(() => expect(screen.getByText("huge.vcf")).toBeTruthy());
    expect(screen.queryByTestId("contact-peek-0")).toBeNull();
  });

  // ── calendars ─────────────────────────────────────────────────────────────

  const ICS = [
    "BEGIN:VCALENDAR", "X-WR-CALNAME:Personal",
    "BEGIN:VEVENT", "UID:a", "SUMMARY:Team standup", "DTSTART:20990105T090000Z", "DTEND:20990105T093000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:b", "SUMMARY:Dentist", "DTSTART;VALUE=DATE:20990107", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("peeks at a .ics as a calendar and opens it from the primary action", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => ICS })) as never;
    mockFile = { ...BASE, name: "Personal.ics", mime_type: "text/calendar", extension: ".ics", size_bytes: ICS.length };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("calendar-peek-0")).toBeTruthy());
    expect(screen.getByText("Team standup")).toBeTruthy();
    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.queryByText(/BEGIN:VEVENT/)).toBeNull();
    fireEvent.press(screen.getByTestId("viewer-primary"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/calendar", params: { id: "f1" } });
  });

  it("knows a .ics by its extension when the mime is generic", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => ICS })) as never;
    mockFile = { ...BASE, name: "export.ics", mime_type: "application/octet-stream", extension: ".ics", size_bytes: ICS.length };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("calendar-stage")).toBeTruthy());
  });

  it("keeps the text stage for a .ics with no events", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "not a calendar" })) as never;
    mockFile = { ...BASE, name: "notes.ics", mime_type: "text/calendar", extension: ".ics", size_bytes: 14 };
    renderViewer();
    await waitFor(() => expect(screen.getByText("not a calendar")).toBeTruthy());
    expect(screen.queryByTestId("calendar-stage")).toBeNull();
  });

  it("shows a calendar over the text cap as an unread card, without fetching its body", async () => {
    mockFile = { ...BASE, name: "Takeout.ics", mime_type: "text/calendar", extension: ".ics", size_bytes: 3 * 1024 * 1024 };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("calendar-stage-unread")).toBeTruthy());
    expect(screen.getByText("Takeout")).toBeTruthy();
    expect(screen.getByText("Calendar · 3.0 MB")).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("viewer-primary"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/calendar", params: { id: "f1" } });
  });

  it("keeps the too-large stage for a .ics over 15 MB", async () => {
    mockFile = { ...BASE, name: "huge.ics", mime_type: "text/calendar", extension: ".ics", size_bytes: 20 * 1024 * 1024 };
    renderViewer();
    await waitFor(() => expect(screen.getByText("huge.ics")).toBeTruthy());
    expect(screen.queryByTestId("calendar-stage")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("restores contacts from the More menu", async () => {
    const { restoreContacts } = require("@/contacts/restoreContacts");
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => VCF })) as never;
    mockFile = { ...BASE, name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf", size_bytes: VCF.length };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-restore-to-phone")).toBeTruthy());
    fireEvent.press(screen.getByTestId("more-restore-to-phone"));
    finishSheetDismissal();
    await waitFor(() => expect(restoreContacts).toHaveBeenCalledWith("file:///cache/c.vcf"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Added 4 contacts"));
  });

  it("offers no contact restore for a non-vcf file", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-rename")).toBeTruthy());
    expect(screen.queryByTestId("more-restore-to-phone")).toBeNull();
  });

  it("opens the conversation on this file from the More menu", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-comments")).toBeTruthy());
    fireEvent.press(screen.getByTestId("more-comments"));
    finishSheetDismissal();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/comments",
      params: { fileId: "f1", name: "notes.txt" },
    });
  });

  it("offers Make available offline in the More menu and pins the file", async () => {
    const pins = require("@/offline/pins") as typeof import("@/offline/pins");
    const pinFile = jest.spyOn(pins, "pinFile").mockResolvedValue(undefined);
    mockFile = { ...BASE, workspace_id: "w1" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-make-available-offline")).toBeTruthy());
    fireEvent.press(screen.getByTestId("more-make-available-offline"));
    finishSheetDismissal();
    await waitFor(() => expect(pinFile).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }), "w1"));
    pinFile.mockRestore();
  });

  it("no offline row in the More menu for a view-only file", async () => {
    mockFile = { ...BASE, workspace_id: "w1", lock_mode: "view_only" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-comments")).toBeTruthy());
    expect(screen.queryByTestId("more-make-available-offline")).toBeNull();
  });

  it("carries the comment count into the More menu label", async () => {
    mockFile = { ...BASE, comment_count: 3 };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByText("Comments (3)")).toBeTruthy());
  });

  // ── audio ─────────────────────────────────────────────────────────────────

  it("hands an unlocked audio file to the player screen", async () => {
    mockFile = { ...BASE, name: "song.mp3", mime_type: "audio/mpeg", extension: ".mp3" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("Play")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-primary"));
    const { playFileQueue } = require("@/player/controller");
    await waitFor(() => expect(playFileQueue).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledWith("/player");
  });

  // Playing a single file would end in silence after one track. The viewer
  // already holds the folder's files - it pages through them - so it queues
  // the same list the list screen's "Play all" would.
  it("queues the whole folder from the track that was opened", async () => {
    useViewerList.getState().setViewerList(
      [
        { ...BASE, id: "a1", name: "one.mp3", mime_type: "audio/mpeg", extension: ".mp3" },
        { ...BASE, id: "f1", name: "song.mp3", mime_type: "audio/mpeg", extension: ".mp3" },
      ] as never,
      "Album",
    );
    mockFile = { ...BASE, name: "song.mp3", mime_type: "audio/mpeg", extension: ".mp3" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("Play")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-primary"));
    const { playFileQueue } = require("@/player/controller");
    await waitFor(() => expect(playFileQueue).toHaveBeenCalled());
    const [files, startId, source] = (playFileQueue as jest.Mock).mock.calls[0];
    expect(files.map((f: { id: string }) => f.id)).toEqual(["a1", "f1"]);
    expect(startId).toBe("f1");
    expect(source).toBe("Album");
  });

  // buildTracks filters lock_mode !== "none" out of the player queue, so an
  // unlocked-but-locked file has no queue entry to hand off to. It has to play
  // where it stands, or unlocking it produces artwork and no way to hear it.
  it("plays a full_lock audio file inline once unlocked, not via the player", async () => {
    mockFile = { ...BASE, name: "song.mp3", mime_type: "audio/mpeg", extension: ".mp3", lock_mode: "full_lock" };
    renderViewer();
    await unlock();
    expect(screen.queryByText("Play")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("inline-audio-player")).toBeTruthy());
    expect(isDisabled("viewer-action-save")).toBe(false);
  });

  // ── reading ───────────────────────────────────────────────────────────────

  it("opens the reader for an epub, with no token when there is none", async () => {
    mockFile = { ...BASE, name: "moby.epub", extension: ".epub", mime_type: "application/epub+zip" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-primary")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-primary"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/read", params: { id: "f1" } });
  });

  it("offers Read for a PDF and for a .txt", async () => {
    mockFile = { ...BASE, name: "scan.pdf", extension: ".pdf", mime_type: "application/pdf" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("Read")).toBeTruthy());
    screen.unmount();

    mockFile = { ...BASE, name: "notes.txt", extension: ".txt", mime_type: "text/plain" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("Read")).toBeTruthy());
  });

  // ── browsing an archive ──────────────────────────────────────────────────

  it("opens the archive browser for a zip, not Save", async () => {
    mockFile = { ...BASE, name: "photos.zip", extension: ".zip", mime_type: "application/zip" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("Browse contents")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-primary"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/file/[id]/archive",
      params: { id: "f1", name: "photos.zip" },
    });
  });

  it("offers nothing to open while lock-gated", async () => {
    mockFile = { ...BASE, extension: ".epub", mime_type: "application/epub+zip", lock_mode: "full_lock" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("unlock-password")).toBeTruthy());
    expect(screen.queryByTestId("viewer-primary")).toBeNull();
  });

  it("offers no primary action for an image - the icon row covers it", async () => {
    mockFile = { ...BASE, name: "pic.png", extension: ".png", mime_type: "image/png" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("pic.png")).toBeTruthy());
    expect(screen.queryByTestId("viewer-primary")).toBeNull();
  });

  it("carries the unlock token into the reader once a locked book is unlocked", async () => {
    mockFile = { ...BASE, name: "moby.epub", extension: ".epub", mime_type: "application/epub+zip", lock_mode: "full_lock" };
    renderViewer();
    await unlock();
    await waitFor(() => expect(screen.getByTestId("viewer-primary")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-primary"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[id]/read", params: { id: "f1", token: "tok_1" } });
  });

  it("reports a wrong password on the gate rather than a toast that scrolls away", async () => {
    const { unlockFile } = require("@/files/mutations");
    (unlockFile as jest.Mock).mockRejectedValueOnce(new Error("Wrong password"));
    mockFile = { ...BASE, lock_mode: "full_lock" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("unlock-password")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("unlock-password"), "nope");
    fireEvent.press(screen.getByTestId("unlock"));
    await waitFor(() => expect(screen.getByTestId("unlock-error")).toBeTruthy());
    expect(screen.getByText("Wrong password")).toBeTruthy();
  });

  // ── details ───────────────────────────────────────────────────────────────

  it("keeps the record behind the grabber until asked for", async () => {
    mockFile = { ...BASE, uploader_name: "Firat Kaya", region: "apac", current_version: 3 };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-grabber")).toBeTruthy());
    expect(screen.queryByTestId("viewer-details")).toBeNull();

    fireEvent.press(screen.getByTestId("viewer-grabber"));
    await waitFor(() => expect(screen.getByTestId("viewer-details")).toBeTruthy());
    expect(screen.getByText("Firat Kaya")).toBeTruthy();
  });

  // Everything in the panel was already on the wire; mobile's type just never
  // declared the columns, so they arrived and were discarded.
  it("shows the region the endpoint already returns, resolved to a city", async () => {
    mockFile = { ...BASE, region: "apac" };
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-grabber")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-grabber"));
    await waitFor(() => expect(screen.getByText("Sydney")).toBeTruthy());
  });

  // ── paging ────────────────────────────────────────────────────────────────

  it("does not page when it was reached without a list - a deep link, say", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-stage")).toBeTruthy());
    expect(screen.queryByTestId("viewer-pager")).toBeNull();
    expect(screen.queryByTestId("viewer-position")).toBeNull();
  });

  it("pages through the folder it was opened from", async () => {
    useViewerList.getState().setViewerList(
      [
        { ...BASE, id: "f0", name: "a.jpg" },
        { ...BASE, id: "f1", name: "notes.txt" },
        { ...BASE, id: "f2", name: "c.jpg" },
      ] as never,
      "Trip",
    );
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-pager")).toBeTruthy());
    expect(screen.getByTestId("viewer-position").props.children).toBe("2 of 3");
  });

  // A settled swipe is read back from the native offset. In RTL page 0 sits at
  // the right and the offset stays left based, so the same x means the
  // mirrored page (see pagerIndex.ts).
  it.each([
    [false, "3 of 3"],
    [true, "1 of 3"],
  ])("reads the settled page from the offset (rtl=%s)", async (rtl, label) => {
    __setLayoutRtlForTests(rtl);
    useViewerList.getState().setViewerList(
      [
        { ...BASE, id: "f0", name: "a.jpg" },
        { ...BASE, id: "f1", name: "notes.txt" },
        { ...BASE, id: "f2", name: "c.jpg" },
      ] as never,
      "Trip",
    );
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-pager")).toBeTruthy());
    const width = Dimensions.get("window").width;
    fireEvent(screen.getByTestId("viewer-pager"), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 2 * width, y: 0 } },
    });
    await waitFor(() => expect(screen.getByTestId("viewer-position").props.children).toBe(label));
  });

  // The pages either side load the real photo, at the size it will have once
  // current, so a swipe never reveals a thumbnail that then jumps to full
  // screen. Pages further out keep the list's thumbnail, and a view-only
  // neighbour is not fetched for a page the user may never reach.
  // The test renderer only lays out pages from the initial one onward, so the
  // current file leads the list here.
  const IMG = { ...BASE, mime_type: "image/jpeg", extension: ".jpg" };
  const photoSources = () =>
    screen.getAllByTestId("image-stage").map((n) => (n.props.source as { uri: string }).uri);

  it("loads the full photo only on the pages either side", async () => {
    mockFile = { ...IMG, name: "b.jpg" };
    useViewerList.getState().setViewerList(
      [
        { ...IMG, id: "f1", name: "b.jpg" },
        { ...IMG, id: "f2", name: "c.jpg" },
        { ...IMG, id: "f3", name: "d.jpg" },
      ] as never,
      "Trip",
    );
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-pager")).toBeTruthy());
    const sources = photoSources();
    expect(sources).toHaveLength(2);
    expect(sources.some((u) => u.includes("/f1/"))).toBe(true);
    expect(sources.some((u) => u.includes("/f2/"))).toBe(true);
  });

  it("does not fetch a view-only neighbour ahead of time", async () => {
    mockFile = { ...IMG, name: "b.jpg" };
    useViewerList.getState().setViewerList(
      [
        { ...IMG, id: "f1", name: "b.jpg" },
        { ...IMG, id: "f2", name: "c.jpg", lock_mode: "view_only" },
      ] as never,
      "Trip",
    );
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-pager")).toBeTruthy());
    expect(photoSources()).toEqual([expect.stringContaining("/f1/")]);
  });

  // ── Live Photos ───────────────────────────────────────────────────────────

  // The pairing columns are computed by the LISTINGS only: GET /api/files/:id
  // projects FILE_COLUMNS, which has neither of them. So `file` here can never
  // say it is a Live Photo, and the viewer has to take the twin's id off the
  // list row it was opened with. Read off `file`, this was dead on device -
  // the stage never mounted and Move to trash never asked about the video -
  // while every unit test still passed, because they fed the pairing fields in
  // through a detail row the API does not send them on.
  describe("a still opened from a listing that paired it", () => {
    const STILL = { ...BASE, name: "IMG_1.HEIC", extension: ".heic", mime_type: "image/heic" };

    beforeEach(() => {
      // The detail row, exactly as the endpoint sends it: no pairing keys.
      mockFile = { ...STILL };
      useViewerList.getState().setViewerList(
        [
          { ...STILL, live_video_id: "v1" },
          { ...BASE, id: "f2", name: "IMG_2.HEIC", extension: ".heic", mime_type: "image/heic" },
        ] as never,
        "Trip",
      );
    });

    it("mounts the Live Photo stage from the list row's pairing field", async () => {
      renderViewer();
      await waitFor(() => expect(screen.getByTestId("live-stage")).toBeTruthy());
    });

    it("asks about the video before moving the photo to the trash", async () => {
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      renderViewer();
      await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
      fireEvent.press(screen.getByTestId("viewer-action-more"));
      await waitFor(() => expect(screen.getByTestId("more-move-to-trash")).toBeTruthy());
      fireEvent.press(screen.getByTestId("more-move-to-trash"));
      finishSheetDismissal();

      expect(alert).toHaveBeenCalled();
      const [title, message, buttons] = alert.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
      expect(title).toBe("Delete photo?");
      expect(message).toBe("Also delete its Live Photo video?");
      expect(buttons.map((b) => b.text)).toEqual(["Keep video", "Delete both", "Cancel"]);

      // "Delete both" has to reach the twin the LIST row named - the mutation
      // reads live_video_id off the file it is handed.
      buttons[1].onPress?.();
      expect(mockRemoveWithTwin).toHaveBeenCalledWith(
        { file: expect.objectContaining({ id: "f1", live_video_id: "v1" }), withTwin: true },
        expect.anything(),
      );
      alert.mockRestore();
    });

    // A deep link or a notification opens the viewer with no list, so there is
    // no pairing to know. A plain image stage is the honest answer.
    it("falls back to a plain image stage when there was no list", async () => {
      useViewerList.getState().clearViewerList();
      renderViewer();
      await waitFor(() => expect(screen.getByTestId("viewer-stage")).toBeTruthy());
      expect(screen.queryByTestId("live-stage")).toBeNull();
    });
  });

  // ── more menu ─────────────────────────────────────────────────────────────

  it("reaches rename, move, copy and trash from the open file", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-rename")).toBeTruthy());
    expect(screen.getByTestId("more-move-to-folder")).toBeTruthy();
    expect(screen.getByTestId("more-make-a-copy")).toBeTruthy();
    expect(screen.getByTestId("more-move-to-trash")).toBeTruthy();
  });

  it("renames in place and refreshes the file", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-rename")).toBeTruthy());
    fireEvent.press(screen.getByTestId("more-rename"));
    finishSheetDismissal();
    await waitFor(() => expect(screen.getByTestId("prompt-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("prompt-input"), "renamed.txt");
    fireEvent.press(screen.getByTestId("submit"));
    expect(mockRename).toHaveBeenCalledWith({ id: "f1", name: "renamed.txt" }, expect.anything());
  });

  it("does not fire a rename that changes nothing", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-action-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("viewer-action-more"));
    await waitFor(() => expect(screen.getByTestId("more-rename")).toBeTruthy());
    fireEvent.press(screen.getByTestId("more-rename"));
    finishSheetDismissal();
    await waitFor(() => expect(screen.getByTestId("prompt-input")).toBeTruthy());
    fireEvent.press(screen.getByTestId("submit"));
    expect(mockRename).not.toHaveBeenCalled();
  });

  // ── failure ───────────────────────────────────────────────────────────────

  // The old screen unmounted the entire route on a failed fetch, taking the
  // actions that would still have worked with it.
  it("keeps the name and the actions when the preview fails", async () => {
    const { getDownloadUrl } = require("@/files/api");
    (getDownloadUrl as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    mockFile = { ...BASE, name: "pic.png", extension: ".png", mime_type: "image/png" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("Try again")).toBeTruthy());
    expect(screen.getByText("pic.png")).toBeTruthy();
    expect(screen.getByTestId("viewer-action-link")).toBeTruthy();
  });

  it("says how big a file is when it is too large to preview inline", async () => {
    mockFile = { ...BASE, name: "worker.log", extension: ".log", mime_type: "text/plain", size_bytes: 412 * 1024 };
    renderViewer();
    // The size shows up twice on purpose: in the meta line and inside the
    // explanation, which is the whole point of the message.
    await waitFor(() => expect(screen.getByText(/412\.0 KB is too large to preview/)).toBeTruthy());
    expect(screen.getByTestId("viewer-meta").props.children).toContain("412.0 KB");
  });

  it("names the type and offers Save when there is no preview for it", async () => {
    mockFile = { ...BASE, name: "payload.dat", extension: ".dat", mime_type: "application/octet-stream" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("DAT")).toBeTruthy());
    expect(screen.getByText("Save to phone")).toBeTruthy();
  });

  // A zip is the one "no preview" type with somewhere better to go: the copy
  // and the button both point at Browse instead of Save, so they can't
  // contradict each other the way "save it to open elsewhere" would next to
  // a button that opens it right here.
  it("names a zip and offers Browse instead of Save, with copy that doesn't contradict it", async () => {
    mockFile = { ...BASE, name: "backup.zip", extension: ".zip", mime_type: "application/zip" };
    renderViewer();
    await waitFor(() => expect(screen.getByText("ZIP archive")).toBeTruthy());
    expect(screen.getByText("Browse this archive without saving it.")).toBeTruthy();
    expect(screen.getByText("Browse contents")).toBeTruthy();
    expect(screen.queryByText("Save to phone")).toBeNull();
  });
});

describe("offline cold start", () => {
  afterEach(() => { mockFileError = false; });

  it("renders the file from the persisted cache even though the refetch failed", async () => {
    mockFile = { ...BASE };
    mockFileError = true;
    renderViewer();
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
    expect(screen.queryByTestId("viewer-reload")).toBeNull();
  });

  it("says quietly that this is the saved copy, so a stale record is never passed off as live", async () => {
    mockFile = { ...BASE };
    mockFileError = true;
    renderViewer();
    expect(await screen.findByTestId("viewer-offline-notice")).toHaveTextContent(/saved copy/i);
  });

  it("shows no such notice when the record is fresh", async () => {
    mockFile = { ...BASE };
    renderViewer();
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
    expect(screen.queryByTestId("viewer-offline-notice")).toBeNull();
  });

  it("still shows the error screen when there is nothing cached to show", async () => {
    mockFile = undefined as never;
    mockFileError = true;
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-reload")).toBeTruthy());
  });
});

describe("available offline", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const read = require("@/offline/read") as { savedCopy: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDownloadUrl } = require("@/files/api") as { getDownloadUrl: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ApiError } = require("@/api/errors") as typeof import("@/api/errors");
  const PDF = { ...BASE, name: "deck.pdf", mime_type: "application/pdf", extension: ".pdf", current_version: 3 };
  const SAVED = "file:///docs/offline/acct/files/f1-v2.pdf";

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: "f1" };
    mockOnline.value = true;
    mockFile = { ...PDF };
    mockFileError = false;
    mockFileErrorObj = null;
    read.savedCopy.mockResolvedValue(null);
    useViewerList.getState().clearViewerList();
  });
  afterAll(() => {
    mockParams = { id: "f1" };
    mockOnline.value = null;
    read.savedCopy.mockResolvedValue(null);
  });

  it("files, online, outdated saved copy: the newer-version bar, and Open newer version streams", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    renderViewer();
    expect(await screen.findByTestId("viewer-newer-version-bar")).toHaveTextContent(/A newer version is on dosya/);
    expect(getDownloadUrl).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("viewer-open-newer-version"));
    await waitFor(() => expect(getDownloadUrl).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("viewer-newer-version-bar")).toBeNull());
  });

  it("offline, outdated saved copy: update pending, no bar, nothing fetched", async () => {
    mockOnline.value = false;
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    renderViewer();
    expect(await screen.findByTestId("viewer-update-pending")).toHaveTextContent(/update pending/);
    expect(screen.queryByTestId("viewer-newer-version-bar")).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("opened from the Offline screen while online: update pending, never the bar", async () => {
    mockParams = { id: "f1", origin: "offline" };
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    renderViewer();
    expect(await screen.findByTestId("viewer-update-pending")).toBeTruthy();
    expect(screen.queryByTestId("viewer-newer-version-bar")).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("a current saved copy carries no note", async () => {
    read.savedCopy.mockResolvedValue({ uri: "file:///docs/offline/acct/files/f1-v3.pdf", version: 3, rendition: "none" });
    renderViewer();
    await waitFor(() => expect(read.savedCopy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("deck.pdf")).toBeTruthy());
    expect(screen.queryByTestId("viewer-newer-version-bar")).toBeNull();
    expect(screen.queryByTestId("viewer-update-pending")).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("online 403 for a saved file: not shown", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 3, rendition: "none" });
    mockFileError = true;
    mockFileErrorObj = new ApiError("Forbidden", 403);
    renderViewer();
    await waitFor(() => expect(screen.getByTestId("viewer-reload")).toBeTruthy());
    expect(screen.queryByText("deck.pdf")).toBeNull();
    expect(read.savedCopy).not.toHaveBeenCalled();
  });

  it("an office file saved without its PDF, offline: preview unavailable offline", async () => {
    mockOnline.value = false;
    mockFile = { ...BASE, name: "r.docx", extension: ".docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    read.savedCopy.mockImplementation(async (_id: string, o?: { variant?: string }) =>
      (o?.variant === "pdf" ? null : { uri: "file:///docs/offline/acct/files/f1-v1.docx", version: 1, rendition: "failed" }));
    renderViewer();
    expect(await screen.findByTestId("viewer-preview-unavailable-offline")).toHaveTextContent(/Preview unavailable offline/);
  });
});

describe("available offline: photos, Live Photos, sharing", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const read = require("@/offline/read") as { savedCopy: jest.Mock; savedOriginalForExport: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDownloadUrl } = require("@/files/api") as { getDownloadUrl: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shareFile } = require("@/files/download") as { shareFile: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useVideoPlayer } = require("expo-video") as { useVideoPlayer: jest.Mock };
  const IMG = { ...BASE, mime_type: "image/jpeg", extension: ".jpg" };
  const savedUri = (id: string) => `file:///docs/offline/acct/files/${id}-v1.jpg`;
  const pinned = (ids: string[]) => async (id: string) =>
    (ids.includes(id) ? { uri: savedUri(id), version: 1, rendition: "none" } : null);
  const photoSources = () =>
    screen.getAllByTestId("image-stage").map((n) => (n.props.source as { uri: string }).uri);

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: "f1" };
    mockFileError = false;
    mockFileErrorObj = null;
    read.savedCopy.mockImplementation(async () => null);
    read.savedOriginalForExport.mockResolvedValue(null);
    useViewerList.getState().clearViewerList();
  });
  afterAll(() => {
    mockOnline.value = null;
    read.savedCopy.mockImplementation(async () => null);
  });

  it("offline pager with pinned photos: the page and its neighbour show their saved copies", async () => {
    mockOnline.value = false;
    mockFile = { ...IMG, name: "b.jpg" };
    read.savedCopy.mockImplementation(pinned(["f1", "f2"]));
    useViewerList.getState().setViewerList(
      [{ ...IMG, id: "f1", name: "b.jpg" }, { ...IMG, id: "f2", name: "c.jpg" }, { ...IMG, id: "f3", name: "d.jpg" }] as never,
      "Trip",
    );
    renderViewer();
    await waitFor(() => expect(photoSources()).toEqual([savedUri("f1"), savedUri("f2")]));
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("a neighbour whose saved copy is still being looked up keeps its thumbnail, never a network source", async () => {
    mockOnline.value = false;
    mockFile = { ...IMG, name: "b.jpg" };
    read.savedCopy.mockImplementation(async (id: string) => (id === "f2" ? new Promise(() => {}) : { uri: savedUri(id), version: 1, rendition: "none" }));
    useViewerList.getState().setViewerList(
      [{ ...IMG, id: "f1", name: "b.jpg" }, { ...IMG, id: "f2", name: "c.jpg" }] as never,
      "Trip",
    );
    renderViewer();
    await waitFor(() => expect(photoSources()).toEqual([savedUri("f1")]));
  });

  it("offline, a network photo that fails is not taken for an undecodable one", async () => {
    mockOnline.value = false;
    mockFile = { ...IMG, name: "b.jpg" };
    renderViewer();
    const stage = await screen.findByTestId("image-stage");
    expect((stage.props.source as { uri: string }).uri).toContain("/api/files/f1/raw");
    fireEvent(stage, "error");
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId("image-stage")).toBeTruthy();
  });

  it("online, a photo that fails to decode still says so", async () => {
    mockOnline.value = true;
    mockFile = { ...IMG, name: "b.jpg" };
    renderViewer();
    fireEvent(await screen.findByTestId("image-stage"), "error");
    await waitFor(() => expect(screen.queryByTestId("image-stage")).toBeNull());
  });

  it("Open newer version on an outdated pinned photo switches the image to the network source", async () => {
    mockOnline.value = true;
    mockFile = { ...IMG, name: "b.jpg", current_version: 2 };
    read.savedCopy.mockImplementation(pinned(["f1"])); // saved at version 1
    renderViewer();
    await waitFor(() => expect(photoSources()).toEqual([savedUri("f1")]));
    fireEvent.press(await screen.findByTestId("viewer-open-newer-version"));
    await waitFor(() => expect(photoSources()[0]).toContain("/api/files/f1/raw"));
  });

  it("a saved photo removed while open is looked up again and falls back to the network", async () => {
    mockOnline.value = true;
    mockFile = { ...IMG, name: "b.jpg" };
    read.savedCopy.mockImplementation(pinned(["f1"]));
    renderViewer();
    await waitFor(() => expect(photoSources()).toEqual([savedUri("f1")]));
    read.savedCopy.mockImplementation(async () => null); // an unpin removed it
    fireEvent(screen.getByTestId("image-stage"), "error");
    await waitFor(() => expect(photoSources()[0]).toContain("/api/files/f1/raw"));
    expect(read.savedCopy.mock.calls.filter((c) => c[0] === "f1").length).toBeGreaterThanOrEqual(2);
  });

  it("a saved photo that still fails after a second look is undecodable", async () => {
    mockOnline.value = false;
    mockFile = { ...IMG, name: "b.jpg" };
    read.savedCopy.mockImplementation(pinned(["f1"]));
    renderViewer();
    await waitFor(() => expect(photoSources()).toEqual([savedUri("f1")]));
    fireEvent(screen.getByTestId("image-stage"), "error");
    await waitFor(() => expect(photoSources()).toEqual([savedUri("f1")]));
    fireEvent(screen.getByTestId("image-stage"), "error");
    await waitFor(() => expect(screen.queryByTestId("image-stage")).toBeNull());
  });

  describe("a Live Photo whose still is saved", () => {
    const STILL = { ...BASE, name: "IMG_1.JPG", extension: ".jpg", mime_type: "image/jpeg" };
    beforeEach(() => {
      mockFile = { ...STILL };
      useViewerList.getState().setViewerList([{ ...STILL, live_video_id: "v1" }] as never, "Trip");
    });
    const lastVideoSource = () => useVideoPlayer.mock.calls.at(-1)?.[0] as { uri: string; headers?: Record<string, string> };

    it("streams its motion with the bearer when the motion is not saved", async () => {
      mockOnline.value = true;
      read.savedCopy.mockImplementation(pinned(["f1"]));
      renderViewer();
      await waitFor(() => expect(lastVideoSource()?.uri).toContain("/api/files/v1/raw"));
      expect(lastVideoSource().headers).toEqual({ Authorization: "Bearer tok" });
    });

    it("plays its saved motion from the phone when that is saved too", async () => {
      mockOnline.value = false;
      read.savedCopy.mockImplementation(pinned(["f1", "v1"]));
      renderViewer();
      await waitFor(() => expect(lastVideoSource()?.uri).toBe(savedUri("v1")));
    });
  });

  it("Share via hands over the saved original, with no download", async () => {
    mockOnline.value = false;
    mockFile = { ...BASE, name: "r.docx", extension: ".docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    read.savedOriginalForExport.mockResolvedValue("file:///cache/offline-export/r.docx");
    renderViewer();
    fireEvent.press(await screen.findByTestId("viewer-action-more"));
    fireEvent.press(await screen.findByTestId("more-share-via"));
    finishSheetDismissal();
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith("file:///cache/offline-export/r.docx"));
    // Nothing was fetched to share it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect((require("@/files/download") as { downloadToCache: jest.Mock }).downloadToCache).not.toHaveBeenCalled();
  });
});

// ── casting ───────────────────────────────────────────────────────────────

describe("casting", () => {
  const VIDEO = { ...BASE, id: "f1", name: "film.mp4", mime_type: "video/mp4", extension: ".mp4", size_bytes: 9000 };
  const connected = () => useCastStore.setState({ status: "connected", deviceName: "Living Room TV", fileId: null });

  beforeEach(() => {
    mockCast.on = true;
    mockCast.session = { getCastDevice: async () => ({ friendlyName: "Living Room TV" }), getClient: () => ({ loadMedia: mockLoadMedia }) };
    useCastStore.setState({ status: "idle", deviceName: null, fileId: null });
    mockFile = { ...VIDEO };
  });
  afterEach(() => { mockCast.on = false; });

  it("offers Cast to TV on a video, lists the TVs and connects to the one picked", async () => {
    mockCast.session = null;
    renderViewer();
    fireEvent.press(await screen.findByTestId("viewer-action-more"));
    fireEvent.press(await screen.findByTestId("more-cast"));
    finishSheetDismissal();
    fireEvent.press(await screen.findByTestId("cast-device-tv1"));
    finishSheetDismissal();
    await waitFor(() => expect(mockStartSession).toHaveBeenCalledWith("tv1"));
  });

  it("sends the open file to a connected TV and steps its own player aside", async () => {
    connected();
    renderViewer();
    await waitFor(() => expect(mockLoadMedia).toHaveBeenCalledWith(expect.objectContaining({
      autoplay: true,
      mediaInfo: expect.objectContaining({ contentUrl: "https://r2/x", contentType: "video/mp4" }),
    })));
    expect(await screen.findByTestId("viewer-casting")).toBeTruthy();
    expect(screen.getByText("Playing on Living Room TV")).toBeTruthy();
    expect(screen.queryByTestId("video-stage")).toBeNull();
  });

  it("Stop casting ends the session and stops the TV", async () => {
    connected();
    renderViewer();
    fireEvent.press(await screen.findByTestId("viewer-casting-stop"));
    await waitFor(() => expect(mockEndSession).toHaveBeenCalledWith(true));
  });

  // The owner switched downloads off; the TV would be a second device holding the bytes.
  it("never offers a view-only video to a TV", async () => {
    mockFile = { ...VIDEO, lock_mode: "view_only" };
    renderViewer();
    fireEvent.press(await screen.findByTestId("viewer-action-more"));
    await screen.findByTestId("more-rename");
    expect(screen.queryByTestId("more-cast")).toBeNull();
  });

  it("leaves a document alone", async () => {
    mockFile = { ...BASE };
    renderViewer();
    fireEvent.press(await screen.findByTestId("viewer-action-more"));
    await screen.findByTestId("more-rename");
    expect(screen.queryByTestId("more-cast")).toBeNull();
  });
});
