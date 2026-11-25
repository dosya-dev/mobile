/**
 * Unit G sweep: sharing. The create and edit sheets, the date picker, the
 * shares list and detail screens, the public share page, the folder share
 * route, the preview card and the messages the payload builders throw, all
 * rendered in a language other than English.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import MySharesScreen from "../../../app/shares/index";
import ShareDetailScreen from "../../../app/shares/[id]";
import ShareView from "../../../app/s/[token]";
import FolderShareScreen from "../../../app/(tabs)/(files)/folder/[id]/share";
import { CreateShareSheet } from "../../share/CreateShareSheet";
import { EditShareSheet } from "../../share/EditShareSheet";
import { DatePickerSheet } from "../../share/DatePickerSheet";
import { buildEmailShareBody, buildShareUpdateBody, buildLinkShareBody } from "../../share/payload";
import * as shareHooks from "../../share/hooks";
import * as shareApi from "../../share/api";
import * as filesHooks from "../../files/hooks";
import { toast } from "../../ui/toast";
import { t, useLocale, __resetI18nForTests } from "../../lib/i18n";
import type { MyShare, SharedWithMe, ShareAnalytics, ShareAnalyticsLink } from "../../share/types";
import { collectTexts, leftoverEnglish, renderInLocale } from "../../../test-utils/i18n-sweep";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../test-utils/i18n-sweep").routerMockWithTitles();
  return { ...base, useLocalSearchParams: () => mockParams.current };
});
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("react-native-qrcode-svg", () => () => null);
jest.mock("@/files/download", () => ({ downloadToCache: jest.fn(async () => "file:///tmp/x"), shareFile: jest.fn(async () => {}) }));
jest.mock("@/share/SharePreview", () => ({ SharePreview: () => null }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { activeId: string | null }) => unknown) => selector({ activeId: "w1" }),
}));

// English that comes from src/ui (unit K): the TextField show-password toggle and the PromptDialog Cancel.

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

const wrap = (ui: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } } })}>
    {ui}
  </QueryClientProvider>
);

const probe: { setPreference: (p: "de" | "en") => Promise<void> } = { setPreference: async () => {} };
function Probe(): null {
  probe.setPreference = useLocale().setPreference as (p: "de" | "en") => Promise<void>;
  return null;
}

const idle = { mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false };
const createLink = { mutateAsync: jest.fn(async () => ({ url: "https://dosya.dev/s/tok" })), isPending: false };

function mockMutations() {
  jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
    createLink, email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
  } as never);
  jest.spyOn(shareHooks, "useIsFreePlan").mockReturnValue(false);
}

function share(over: Partial<MyShare> = {}): MyShare {
  return {
    link_id: "l1", token: "t1", url: "https://dosya.dev/s/t1",
    display_name: "a.txt", file_id: "f1", file_name: "a.txt",
    folder_id: null, folder_name: null, is_folder: false, is_bundle: 0,
    size_bytes: 100, extension: "txt", region: "weur",
    is_password_protected: 0, lock_mode: "none", access_mode: "public", recipient_count: 0,
    is_revoked: 0, revoked_at: null, expires_at: NOW + 5 * DAY,
    view_count: 2, download_count: 1, max_downloads: null, shared_at: NOW - DAY,
    created_by: "u1", sharer_name: "Me", status: "active", is_mine: true,
    ...over,
  };
}

function withMeRow(over: Partial<SharedWithMe> = {}): SharedWithMe {
  return {
    link_id: "wm1", url: "https://dosya.dev/s/wtok", display_name: "brief.pdf",
    is_folder: false, is_bundle: false, size_bytes: 2048, extension: "pdf",
    is_password_protected: 0, lock_mode: "none",
    expires_at: null, revoked_at: null, status: "active",
    shared_at: NOW - DAY, invited_at: NOW - DAY,
    verified_at: null, sender_name: "Dana",
    ...over,
  };
}

function mockLists(links: MyShare[], withMe: SharedWithMe[] = [], emailVerified = true) {
  jest.spyOn(shareHooks, "useMyShares").mockReturnValue({
    data: {
      links,
      stats: { total: links.length, active: 1, expiring: 1, total_views: 8 },
    },
    isLoading: false, isRefetching: false, refetch: jest.fn(),
  } as never);
  jest.spyOn(shareHooks, "useSharedWithMe").mockReturnValue({
    data: { links: withMe, emailVerified, stats: { total: withMe.length, active: 0, unopened: 0 } },
    isLoading: false, isRefetching: false, refetch: jest.fn(),
  } as never);
}

function analytics(over: Partial<ShareAnalytics> = {}, linkOver: Partial<ShareAnalytics["link"]> = {}): ShareAnalytics {
  return {
    link: {
      link_id: "l1", url: "https://dosya.dev/s/tok", display_name: "Q3.pdf",
      is_folder: false, is_bundle: false, file_id: "f1", size_bytes: 2048,
      extension: "pdf", region: "weur", created_at: NOW - DAY * 6,
      created_by: "u1", created_by_name: "Me", is_mine: false,
      expires_at: NOW + 5 * DAY, is_revoked: false, revoked_at: null,
      is_password_protected: true, lock_mode: "none", access_mode: "restricted",
      status: "active", view_count: 86, download_count: 12,
      max_downloads: 12, downloads_left: 0,
      ...linkOver,
    },
    range: 30,
    timeline: [{ day: "2026-09-01", opens: 4, downloads: 1 }, { day: "2026-09-02", opens: 9, downloads: 3 }],
    reach: { visitors: 14, truncated: false, devices: [], browsers: [] },
    recipients: [
      { email: "ada@x.com", invited_at: NOW - 200, verified_at: NOW - 100 },
      { email: "bob@x.com", invited_at: NOW - 200, verified_at: null },
    ],
    log: {
      total: 3, offset: 0, limit: 50,
      rows: [
        { id: "e1", visitor: "a4f81c02", event: "download", device: "mobile", device_label: "iPhone", country: "nl", viewed_at: NOW - 7200 },
        { id: "e2", visitor: "7b20de55", event: "view", device: "desktop", device_label: "Mac", country: null, viewed_at: NOW - DAY },
      ],
    },
    gaps: { repeat_visits: "a returning visitor is deduped by ip_hash", per_recipient: "each address counts once" },
    ...over,
  };
}

function mockAnalytics(a: ShareAnalytics | null, state: { isError?: boolean } = {}) {
  jest.spyOn(shareHooks, "useShareAnalytics").mockReturnValue({
    data: a ?? undefined, isLoading: false, isError: state.isError ?? false, isRefetching: false, refetch: jest.fn(),
  } as never);
}

function editLink(over: Partial<ShareAnalyticsLink> = {}): ShareAnalyticsLink {
  return analytics({}, { downloads_left: null, max_downloads: null, ...over } as never).link as ShareAnalyticsLink;
}

type Payload = shareApi.SharePayload;
function payload(over: Partial<Payload> = {}): Payload {
  const file = { id: "f1", name: "shared.pdf", size_bytes: 2048, mime_type: "application/pdf", extension: "pdf" };
  return {
    isFolder: false, isBundle: false, lockMode: "none",
    requiresPassword: false, requiresRecipientVerification: false,
    files: [file], file, folder: null, viewCount: 3, downloadCount: 0, expiresAt: NOW + 6 * DAY,
    ...over,
  } as Payload;
}

function mockOpen(p: Payload | Error) {
  jest.spyOn(shareApi, "openShare").mockImplementation(async () => {
    if (p instanceof Error) throw p;
    return p;
  });
}
function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  __resetI18nForTests();
  mockParams.current = {};
  mockMutations();
  jest.spyOn(shareHooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
  jest.spyOn(shareHooks, "useWorkspaceShareDefault").mockReturnValue({ data: 14 } as never);
  jest.spyOn(filesHooks, "useWorkspaces").mockReturnValue({ data: [{ id: "w1" }] } as never);
});

describe("the create sheet in Turkish", () => {
  const file = { kind: "file", id: "f1", name: "beach.jpg", sizeBytes: 2048, extension: "jpg" } as const;
  const folder = { kind: "folder", id: "d1", name: "Trip", itemCount: 4 } as const;

  it("the link tab, the email tab and the created state have no leftover English", async () => {
    const view = await renderInLocale(<CreateShareSheet visible target={file} onClose={jest.fn()} />, "tr");
    expect(view.leftover({ allow: ["beach.jpg"] })).toEqual([]);
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    expect(view.leftover()).toEqual([]);
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", false);
    fireEvent.press(screen.getByTestId("tab-email"));
    expect(view.leftover()).toEqual([]);
    fireEvent(screen.getByTestId("toggle-restricted"), "valueChange", true);
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("tab-link"));
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    fireEvent.changeText(screen.getByTestId("password-field"), "longenough1");
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(screen.getByTestId("share-qr")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });

  it("every validation message has no leftover English", async () => {
    const view = await renderInLocale(<CreateShareSheet visible target={file} onClose={jest.fn()} />, "tr");
    fireEvent.changeText(screen.getByTestId("max-downloads"), "0");
    fireEvent.press(screen.getByTestId("create-link"));
    expect(screen.getByTestId("create-error")).toBeTruthy();
    expect(view.leftover()).toEqual([]);
    fireEvent.changeText(screen.getByTestId("max-downloads"), "");
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    fireEvent.press(screen.getByTestId("create-link"));
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("tab-email"));
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", false);
    fireEvent.press(screen.getByTestId("send-email"));
    expect(view.leftover()).toEqual([]);
    fireEvent.changeText(screen.getByTestId("email-input"), "nope");
    fireEvent(screen.getByTestId("email-input"), "submitEditing");
    expect(screen.getByTestId("create-error").props.children).toBe(t("sharing.error.partIsNotAValidEmailAddress", { part: "nope" }));
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("expiry-custom"));
    expect(view.leftover()).toEqual([]);
  });

  it("the folder sheet and its exclusion notice follow the plural in Polish for 1, 3 and 5", async () => {
    for (const n of [1, 3, 5]) {
      jest.spyOn(shareHooks, "useFolderShareExclusions").mockReturnValue({ data: n } as never);
      const view = await renderInLocale(<CreateShareSheet visible target={folder} onClose={jest.fn()} />, "pl");
      const expected = t("sharing.description.countPluralOneItemStaysOutOfThisLinkHiddenFromYouOrLocked", { count: n });
      expect(screen.getByText(expected)).toBeTruthy();
      expect(view.leftover({ allow: ["Trip"] })).toEqual([]);
      view.unmount();
    }
  });

  it("the send button follows the plural in Polish for 1, 3 and 5", async () => {
    const view = await renderInLocale(<CreateShareSheet visible target={file} onClose={jest.fn()} />, "pl");
    fireEvent.press(screen.getByTestId("tab-email"));
    for (const n of [1, 3, 5]) {
      for (let i = 0; i < n; i++) {
        fireEvent.changeText(screen.getByTestId("email-input"), `p${n}${i}@x.com`);
        fireEvent(screen.getByTestId("email-input"), "submitEditing");
      }
      expect(screen.getByText(t("sharing.action.sendToCountPluralOnePersonOtherPeople", { count: n }))).toBeTruthy();
      for (let i = 0; i < n; i++) fireEvent.press(screen.getByTestId(`remove-p${n}${i}@x.com`));
    }
    expect(view.leftover()).toEqual([]);
  });

  it("switches language in place while open", async () => {
    await renderInLocale(<><Probe /><CreateShareSheet visible target={file} onClose={jest.fn()} /></>, "en");
    expect(screen.getByText("Get a link")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(screen.queryByText("Get a link")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: ["beach.jpg"] })).toEqual([]);
  });

  it("English reads as before, with the approved rewording", async () => {
    await renderInLocale(<CreateShareSheet visible target={file} onClose={jest.fn()} />, "en");
    expect(screen.getByText("View only, no downloads")).toBeTruthy();
    expect(screen.getByText("Get a link")).toBeTruthy();
    expect(screen.getByText("Workspace default · 14 days")).toBeTruthy();
    fireEvent.press(screen.getByTestId("tab-email"));
    expect(screen.getAllByText("Send by email").length).toBeGreaterThan(0);
    // Defect fix (Task 8 catalog key): zero recipients reads "Send to people", as before i18n.
    expect(screen.getByTestId("send-email")).toHaveTextContent("Send to people");
  });
});

describe("the edit sheet in Turkish", () => {
  it("every control, notice and error has no leftover English", async () => {
    const link = editLink({ download_count: 3 });
    const view = await renderInLocale(
      <EditShareSheet visible link={link} recipientEmails={["ada@x.com"]} onClose={jest.fn()} />, "tr",
    );
    expect(view.leftover()).toEqual([]);
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    fireEvent.press(screen.getByTestId("access-public"));
    fireEvent.press(screen.getByTestId("access-restricted"));
    expect(view.leftover()).toEqual([]);
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", false);
    fireEvent.changeText(screen.getByTestId("max-downloads"), "2");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(screen.getByTestId("edit-error").props.children).toBe(t("shared-links.error.thisLinkHasAlreadyBeenDownloadedDownloadCountTimesSetTheLimitToDownloadCountOr", { downloadCount: 3 }));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "0");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(view.leftover()).toEqual([]);
  });

  it("the view-only notice follows the plural in Polish for 1, 3 and 5", async () => {
    for (const n of [1, 3, 5]) {
      const view = await renderInLocale(
        <EditShareSheet visible link={editLink({ download_count: n })} recipientEmails={[]} onClose={jest.fn()} />, "pl",
      );
      fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
      expect(screen.getByText(t("shared-links.description.turningOnViewOnlyStopsTheDownloadCountPluralOnePersonOtherPeopleWhoAlready", { downloadCount: n }))).toBeTruthy();
      expect(view.leftover()).toEqual([]);
      view.unmount();
    }
  });

  it("a link with no password and no limit has no leftover English", async () => {
    const link = editLink({ is_password_protected: false, access_mode: "public", expires_at: null });
    const view = await renderInLocale(<EditShareSheet visible link={link} recipientEmails={[]} onClose={jest.fn()} />, "tr");
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    expect(view.leftover()).toEqual([]);
  });

  it("English reads as before, with the approved rewording", async () => {
    await renderInLocale(<EditShareSheet visible link={editLink()} recipientEmails={[]} onClose={jest.fn()} />, "en");
    expect(screen.getByText("View only, no downloads")).toBeTruthy();
    expect(screen.getByText("Edit this link")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("max-downloads"), "0");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(screen.getByTestId("edit-error").props.children).toBe("Download limit must be a whole number of at least 1.");
  });
});

describe("the date picker in Turkish", () => {
  it("has no leftover English and names the picked date in the language", async () => {
    const view = await renderInLocale(<DatePickerSheet visible onCancel={jest.fn()} onPick={jest.fn()} />, "tr");
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("cal-day-28"));
    expect(view.leftover()).toEqual([]);
    expect(collectTexts().some((s) => s.includes(t("common.description.theLinkWorksThroughDate", { date: "@" }).split("@")[0].trim()))).toBe(true);
  });
});

describe("the shares list in Turkish", () => {
  it("both tabs and every state have no leftover English", async () => {
    mockLists(
      [share(), share({ link_id: "l2", display_name: "b.txt", status: "expiring", is_mine: false, sharer_name: "Dana", access_mode: "restricted", recipient_count: 3, is_password_protected: 1, lock_mode: "view_only" })],
      [withMeRow(), withMeRow({ link_id: "wm2", status: "revoked", sender_name: null }), withMeRow({ link_id: "wm3", status: "expired" }), withMeRow({ link_id: "wm4", verified_at: NOW })],
    );
    const view = await renderInLocale(wrap(<MySharesScreen />), "tr");
    const allow = ["a.txt", "b.txt", "brief.pdf"];
    expect(view.leftover({ allow })).toEqual([]);
    fireEvent(screen.getByTestId("share-search"), "changeText", "zzz");
    expect(view.leftover({ allow })).toEqual([]);
    fireEvent.changeText(screen.getByTestId("share-search"), "");
    fireEvent(screen.getByTestId("share-row-l1"), "longPress");
    expect(view.leftover({ allow })).toEqual([]);
    fireEvent.press(screen.getByTestId("shares-tab-with-me"));
    expect(view.leftover({ allow })).toEqual([]);
  });

  it("the revoke confirm dialog has no leftover English", async () => {
    mockLists([share()]);
    const view = await renderInLocale(wrap(<MySharesScreen />), "tr");
    fireEvent.press(screen.getByTestId("revoke-l1"));
    // The dialog's Cancel button is src/ui/ConfirmDialog (unit K).
    expect(view.leftover({ allow: ["a.txt"] })).toEqual([]);
  });

  it("the empty and unverified states have no leftover English", async () => {
    mockLists([], []);
    const view = await renderInLocale(wrap(<MySharesScreen />), "tr");
    expect(view.leftover()).toEqual([]);
    view.unmount();
    mockLists([], [], false);
    const second = await renderInLocale(wrap(<MySharesScreen />), "tr");
    fireEvent.press(screen.getByTestId("shares-tab-with-me"));
    expect(second.leftover()).toEqual([]);
  });

  it("switches language in place", async () => {
    mockLists([share()]);
    await renderInLocale(wrap(<><Probe /><MySharesScreen /></>), "en");
    expect(screen.getByText("Shared by me")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(screen.queryByText("Shared by me")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: ["a.txt"] })).toEqual([]);
  });

  it("English reads as before", async () => {
    mockLists([share({ is_mine: false, sharer_name: "Dana", expires_at: NOW + 5 * DAY + 3600 })], [withMeRow()]);
    await renderInLocale(wrap(<MySharesScreen />), "en");
    expect(screen.getByText("Shared with me · 1")).toBeTruthy();
    expect(screen.getByText("5 days left · by Dana")).toBeTruthy();
    expect(screen.getByText("1 dl")).toBeTruthy();
    expect(screen.getByLabelText("Copy link")).toBeTruthy();
    expect(screen.getByLabelText("Revoke share")).toBeTruthy();
    fireEvent.press(screen.getByTestId("shares-tab-with-me"));
    expect(screen.getByLabelText("brief.pdf from Dana")).toBeTruthy();
    expect(screen.getByText(/^From Dana · .+/)).toBeTruthy();
  });
});

describe("the share detail screen in Turkish", () => {
  it("every section has no leftover English", async () => {
    mockParams.current = { id: "l1" };
    mockAnalytics(analytics());
    const view = await renderInLocale(wrap(<ShareDetailScreen />), "tr");
    const allow = ["Q3.pdf", "a returning visitor is deduped by ip_hash", "each address counts once", "iPhone", "Mac"];
    expect(view.leftover({ allow })).toEqual([]);
    fireEvent.press(screen.getByTestId("revoke-link"));
    expect(view.leftover({ allow })).toEqual([]);
  });

  it("the other states have no leftover English", async () => {
    mockParams.current = { id: "l1" };
    mockAnalytics(analytics({ recipients: null, timeline: [], log: { total: 0, offset: 0, limit: 50, rows: [] }, gaps: { repeat_visits: "x", per_recipient: null } }, {
      is_mine: true, is_password_protected: false, access_mode: "public", lock_mode: "view_only", max_downloads: null, downloads_left: null,
    }));
    const view = await renderInLocale(wrap(<ShareDetailScreen />), "tr");
    expect(view.leftover({ allow: ["Q3.pdf", "x"] })).toEqual([]);
    view.unmount();
    mockAnalytics(null, { isError: true });
    const failed = await renderInLocale(wrap(<ShareDetailScreen />), "tr");
    expect(failed.leftover()).toEqual([]);
  });

  it("the event count follows the plural in Polish for 1, 3 and 5", async () => {
    mockParams.current = { id: "l1" };
    for (const n of [1, 3, 5]) {
      mockAnalytics(analytics({ log: { total: n, offset: 0, limit: 50, rows: [] } }));
      const view = await renderInLocale(wrap(<ShareDetailScreen />), "pl");
      expect(screen.getByText(t("shared-links.label.totalPluralOneEventOtherEvents", { total: n }))).toBeTruthy();
      view.unmount();
    }
  });

  it("switches language in place", async () => {
    mockParams.current = { id: "l1" };
    mockAnalytics(analytics());
    await renderInLocale(wrap(<><Probe /><ShareDetailScreen /></>), "en");
    expect(screen.getByText("Link settings")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(screen.queryByText("Link settings")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: ["Q3.pdf", "a returning visitor is deduped by ip_hash", "each address counts once", "iPhone", "Mac"] })).toEqual([]);
  });

  it("English reads as before, with the approved rewording", async () => {
    mockParams.current = { id: "l1" };
    mockAnalytics(analytics());
    await renderInLocale(wrap(<ShareDetailScreen />), "en");
    expect(screen.getByLabelText("Copy link")).toBeTruthy();
    expect(screen.getByText("Opens count first visits: a returning visitor is deduped by ip_hash. Per person, each address counts once.")).toBeTruthy();
    expect(screen.getByText("This link has used all 12 of its downloads and will not serve the file again. Raise the limit to let it through.")).toBeTruthy();
    expect(screen.getByText("Only invited · 2")).toBeTruthy();
    expect(screen.getByText("12 of 12 used")).toBeTruthy();
    expect(screen.getByText(/^2 KB · shared .* by Me$|^2\.0 KB · shared .* by Me$|shared .* by Me/)).toBeTruthy();
    expect(screen.getByText("3 events")).toBeTruthy();
    expect(screen.getByText("1 of 2 opened")).toBeTruthy();
    expect(screen.getByText("30d")).toBeTruthy();
  });
});

describe("the public share page in Turkish", () => {
  beforeEach(() => { mockParams.current = { token: "tok" }; });

  it("the file view has no leftover English", async () => {
    mockOpen(payload());
    const view = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(screen.getByTestId("download-shared")).toBeTruthy());
    expect(view.leftover({ allow: ["shared.pdf"] })).toEqual([]);
  });

  it("the view-only note has no leftover English", async () => {
    mockOpen(payload({ lockMode: "view_only" }));
    const view = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(screen.getByTestId("copy-share-link")).toBeTruthy());
    expect(view.leftover({ allow: ["shared.pdf"] })).toEqual([]);
  });

  it.each([
    [410, "The link has been revoked"],
    [410, "gone"],
    [404, "not found"],
    [500, "boom"],
  ])("a %s error (%s) has no leftover English and follows a language switch", async (status, message) => {
    mockOpen(httpError(status, message));
    const view = await renderInLocale(<><Probe /><ShareView /></>, "tr");
    await waitFor(() => expect(collectTexts().length).toBeGreaterThan(3));
    expect(view.leftover()).toEqual([]);
    const before = collectTexts().join("|");
    await act(async () => { await probe.setPreference("de"); });
    await waitFor(() => expect(collectTexts().join("|")).not.toBe(before));
    expect(leftoverEnglish(collectTexts(), "de")).toEqual([]);
  });

  it("the password gate has no leftover English", async () => {
    mockOpen(payload({ requiresPassword: true }));
    const view = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(collectTexts().length).toBeGreaterThan(2));
    expect(view.leftover()).toEqual([]);
  });

  it("the recipient gate has no leftover English on either step", async () => {
    mockOpen(payload({ requiresRecipientVerification: true }));
    jest.spyOn(shareApi, "requestShareCode").mockResolvedValue(undefined as never);
    const view = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(screen.getByTestId("send-code")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    fireEvent.changeText(screen.getByTestId("recipient-email"), "ada@x.com");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(screen.getByTestId("verify-code")).toBeTruthy());
    expect(view.leftover({ allow: ["ada@x.com"] })).toEqual([]);
    jest.spyOn(shareApi, "verifyShareCode").mockRejectedValue("no");
    fireEvent.press(screen.getByTestId("verify-code"));
    await waitFor(() => expect(screen.getByTestId("recipient-error")).toBeTruthy());
    expect(screen.getByTestId("recipient-error").props.children).toBe(t("shared-link.error.thatCodeDidNotWork"));
  });

  it("a folder, a bundle and an empty folder have no leftover English", async () => {
    const folder = { current_name: "Trip", root_name: "Trip", breadcrumb: [], subfolders: [{ id: "s1", name: "Day 1" }] };
    mockOpen(payload({ isFolder: true, folder: folder as never, files: [] }));
    const first = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(screen.getByTestId("shared-folder-s1")).toBeTruthy());
    expect(first.leftover({ allow: ["Trip", "Day 1"] })).toEqual([]);
    first.unmount();

    mockOpen(payload({ isFolder: true, folder: { ...folder, subfolders: [] } as never, files: [] }));
    const empty = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(collectTexts().length).toBeGreaterThan(2));
    expect(empty.leftover({ allow: ["Trip"] })).toEqual([]);
    empty.unmount();

    const f2 = { id: "f2", name: "two.pdf", size_bytes: 10, mime_type: "application/pdf", extension: "pdf" };
    mockOpen(payload({ isBundle: true, files: [payload().files[0], f2] }));
    const bundle = await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(collectTexts().length).toBeGreaterThan(3));
    expect(bundle.leftover({ allow: ["shared.pdf", "two.pdf"] })).toEqual([]);
  });

  it("English reads as before", async () => {
    mockOpen(httpError(410, "revoked"));
    await renderInLocale(<ShareView />, "en");
    await waitFor(() => expect(screen.getByText("This link was turned off")).toBeTruthy());
    expect(screen.getByText("The person who shared it revoked the link. Ask them for a new one.")).toBeTruthy();
    expect(screen.getByTestId("screen-title").props.children).toBe("Shared");
  });
});

describe("the folder share route, the preview card and the thrown messages", () => {
  it("the folder route title and fallback name translate", async () => {
    mockParams.current = { id: "d1" };
    const view = await renderInLocale(<FolderShareScreen />, "tr");
    expect(view.leftover()).toEqual([]);
    expect(screen.getAllByTestId("screen-title")[0].props.children).toBe(t("sharing.heading.shareFolder"));
  });

  it("payload builders throw the language's text", async () => {
    await renderInLocale(<Text>x</Text>, "tr");
    expect(() => buildEmailShareBody({ emails: [], restrictToRecipients: false })).toThrow(t("common.label.buildemailsharebodyAtLeastOneRecipientIsRequired"));
    expect(() => buildEmailShareBody({ emails: ["nope"], restrictToRecipients: false })).toThrow(t("common.label.emailIsNotAValidEmailAddress", { email: "nope" }));
    expect(() => buildShareUpdateBody({})).toThrow(t("common.label.buildshareupdatebodyNothingToUpdate"));
    expect(() => buildShareUpdateBody({ maxDownloads: 0 })).toThrow(t("common.description.downloadLimitMustBeAWholeNumberOfAtLeast1"));
    expect(() => buildLinkShareBody({ maxDownloads: 0 })).toThrow(t("common.description.downloadLimitMustBeAWholeNumberOfAtLeast1"));
    expect(t("common.description.downloadLimitMustBeAWholeNumberOfAtLeast1")).not.toBe("Download limit must be a whole number of at least 1.");
  });

  it("the mutation toasts translate", async () => {
    // The real hooks are needed here, so undo the spy for this case.
    jest.restoreAllMocks();
    const { renderHook } = jest.requireActual("@testing-library/react-native") as typeof import("@testing-library/react-native");
    await renderInLocale(<Text>x</Text>, "tr");
    jest.spyOn(shareApi, "revokeShare").mockResolvedValue(undefined as never);
    jest.spyOn(shareApi, "shareViaEmail").mockResolvedValue(undefined as never);
    jest.spyOn(shareApi, "updateShare").mockResolvedValue(undefined as never);
    jest.spyOn(shareApi, "createShareLink").mockRejectedValue("no");
    const { result } = renderHook(() => shareHooks.useShareMutations(), { wrapper: ({ children }) => wrap(<>{children}</>) });
    await act(async () => { await result.current.revoke.mutateAsync("l1"); });
    await act(async () => { await result.current.email.mutateAsync({ fileId: "f", opts: { emails: ["a@b.co"] } as never }); });
    await act(async () => { await result.current.update.mutateAsync({ linkId: "l", input: {} as never }); });
    await act(async () => { await result.current.createLink.mutateAsync({ fileId: "f", opts: {} as never }).catch(() => {}); });
    const shown = (toast as jest.Mock).mock.calls.map((c) => c[0]);
    expect(shown).toEqual([
      t("common.status.revoked"),
      t("common.status.emailSent"),
      t("common.status.linkUpdated"),
      t("common.error.somethingWentWrong"),
    ]);
  });
});
