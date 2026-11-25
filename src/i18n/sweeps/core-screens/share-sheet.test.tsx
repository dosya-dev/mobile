/**
 * Core-screen sweep: the share sheet (link tab, email tab, created state,
 * validation) and the edit sheet in tr, de, pl and zh-Hans with no leftover
 * English. Mocks follow ../g.test.tsx.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { CreateShareSheet } from "@/share/CreateShareSheet";
import { EditShareSheet } from "@/share/EditShareSheet";
import * as shareHooks from "@/share/hooks";
import * as filesHooks from "@/files/hooks";
import { __resetI18nForTests, t } from "@/lib/i18n";
import type { ShareAnalytics, ShareAnalyticsLink } from "@/share/types";
import { renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";

jest.mock("expo-router", () => require("../../../../test-utils/i18n-sweep").routerMockWithTitles());
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("react-native-qrcode-svg", () => () => null);
jest.mock("@/files/download", () => ({ downloadToCache: jest.fn(async () => "file:///tmp/x"), shareFile: jest.fn(async () => {}) }));
jest.mock("@/share/SharePreview", () => ({ SharePreview: () => null }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { activeId: string | null }) => unknown) => selector({ activeId: "w1" }),
}));

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

const idle = { mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false };
const createLink = { mutateAsync: jest.fn(async () => ({ url: "https://dosya.dev/s/tok" })), isPending: false };

function editLink(over: Partial<ShareAnalyticsLink> = {}): ShareAnalyticsLink {
  const link: ShareAnalytics["link"] = {
    link_id: "l1", url: "https://dosya.dev/s/tok", display_name: "Q3.pdf",
    is_folder: false, is_bundle: false, file_id: "f1", size_bytes: 2048,
    extension: "pdf", region: "weur", created_at: NOW - DAY * 6,
    created_by: "u1", created_by_name: "Me", is_mine: false,
    expires_at: NOW + 5 * DAY, is_revoked: false, revoked_at: null,
    is_password_protected: true, lock_mode: "none", access_mode: "restricted",
    status: "active", view_count: 86, download_count: 12,
    max_downloads: null, downloads_left: null,
  };
  return { ...link, ...over } as ShareAnalyticsLink;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  __resetI18nForTests();
  jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
    createLink, email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
  } as never);
  jest.spyOn(shareHooks, "useIsFreePlan").mockReturnValue(false);
  jest.spyOn(shareHooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
  jest.spyOn(shareHooks, "useWorkspaceShareDefault").mockReturnValue({ data: 14 } as never);
  jest.spyOn(filesHooks, "useWorkspaces").mockReturnValue({ data: [{ id: "w1" }] } as never);
});

describe.each(SWEEP_LOCALES)("Share sheet in %s", (locale) => {
  const file = { kind: "file", id: "f1", name: "beach.jpg", sizeBytes: 2048, extension: "jpg" } as const;
  const folder = { kind: "folder", id: "d1", name: "Trip", itemCount: 4 } as const;

  it("the link tab, the email tab and the created state", async () => {
    const view = await renderInLocale(<CreateShareSheet visible target={file} onClose={jest.fn()} />, locale);
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

  it("every validation message", async () => {
    const view = await renderInLocale(<CreateShareSheet visible target={file} onClose={jest.fn()} />, locale);
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

  it("a folder target", async () => {
    const view = await renderInLocale(<CreateShareSheet visible target={folder} onClose={jest.fn()} />, locale);
    expect(view.leftover({ allow: ["Trip"] })).toEqual([]);
  });

  it("the edit sheet: controls, access modes and the limit errors", async () => {
    const view = await renderInLocale(
      <EditShareSheet visible link={editLink({ download_count: 3 })} recipientEmails={["ada@x.com"]} onClose={jest.fn()} />,
      locale,
    );
    expect(view.leftover()).toEqual([]);
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    fireEvent.press(screen.getByTestId("access-public"));
    fireEvent.press(screen.getByTestId("access-restricted"));
    expect(view.leftover()).toEqual([]);
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", false);
    fireEvent.changeText(screen.getByTestId("max-downloads"), "2");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(screen.getByTestId("edit-error")).toBeTruthy();
    expect(view.leftover()).toEqual([]);
    fireEvent.changeText(screen.getByTestId("max-downloads"), "0");
    fireEvent.press(screen.getByTestId("save-link"));
    expect(view.leftover()).toEqual([]);
  });
});
