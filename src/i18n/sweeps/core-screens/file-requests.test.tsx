/**
 * Core-screen sweep: file requests (list, create sheet, detail) in tr, de,
 * pl and zh-Hans with no leftover English. Mocks follow ../h.test.tsx.
 */
import type { ReactElement } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetI18nForTests } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";
import { collectTexts, leftoverEnglish, renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { toast } from "@/ui/toast";
import { listRequests, createRequest, listUploads, listRecipients } from "@/requests/api";
import { CreateRequestSheet } from "@/requests/CreateRequestSheet";
import RequestsScreen from "../../../../app/file-requests/index";
import RequestDetailScreen from "../../../../app/file-requests/[id]";

function mockRouterModule(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../../test-utils/i18n-sweep").routerMockWithTitles();
  return { ...base, useLocalSearchParams: () => ({ id: "fr_1" }) };
}
jest.mock("expo-router", () => mockRouterModule());
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));
jest.mock("@/requests/api", () => ({
  listRequests: jest.fn(),
  createRequest: jest.fn(),
  listUploads: jest.fn(),
  listRecipients: jest.fn(),
  addRecipient: jest.fn(),
  removeRecipient: jest.fn(),
  resendInvite: jest.fn(),
  patchRequest: jest.fn(),
  revokeRequest: jest.fn(),
}));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, permissions: null }),
}));

const mockToast = toast as jest.Mock;

// User data and server text, never translated.
const DATA = ["Brand assets", "guest@example.com", "a@b.c", "logo.png", "Guest"];
// Shared controls in src/ui (unit K): the dialogs' default Cancel and the
// password field's toggle. They are English until that unit lands.

const NOW = Math.floor(Date.now() / 1000);

const request = (over: Record<string, unknown> = {}) => ({
  id: "fr_1", token: "tok", title: "Brand assets", message: "Please send the logo",
  is_password_protected: 1, expires_at: NOW + 86400 * 5, allowed_extensions: ".jpg, pdf",
  max_file_size_bytes: 5 * 1024 * 1024, max_files: 3, upload_count: 1, is_revoked: 0,
  created_at: NOW - 100, folder_id: null, created_by_name: "Ada",
  folder_name: null, url: "https://dosya.dev/upload-request/tok", ...over,
}) as any;
const upload = () => ({
  id: "fru_1", file_id: "f1", uploader_email: "guest@example.com", uploader_name: null,
  created_at: NOW - 50, file_name: "logo.png", size_bytes: 2048, mime_type: "image/png", extension: ".png",
}) as any;
const recipient = (over: Record<string, unknown> = {}) => ({
  id: "rcp_1", email: "a@b.c", token: "t", sent_at: NOW - 60, uploaded_at: null, created_at: NOW - 60, ...over,
}) as any;

let qc: QueryClient;
function wrap(ui: ReactElement): ReactElement {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}
afterEach(() => qc?.clear());

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  useWorkspaceStore.setState({ activeId: "w1" });
  (listRequests as jest.Mock).mockResolvedValue([request(), request({ id: "fr_2", title: null, is_revoked: 1, expires_at: null, max_files: null, allowed_extensions: null, max_file_size_bytes: null, folder_id: "x", folder_name: null })]);
  (createRequest as jest.Mock).mockResolvedValue({ url: "https://dosya.dev/upload-request/new" });
  (listUploads as jest.Mock).mockResolvedValue({ request: request(), uploads: [upload()] });
  (listRecipients as jest.Mock).mockResolvedValue([recipient(), recipient({ id: "rcp_2", email: "u@v.w", uploaded_at: NOW }), recipient({ id: "rcp_3", email: "n@o.p", sent_at: null })]);
});

async function expectClean(locale: Locale, ui: ReactElement, opts?: { allow?: string[]; after?: () => Promise<void> | void; ready?: string }) {
  const r = await renderInLocale(ui, locale);
  if (opts?.ready) await waitFor(() => expect(screen.getByTestId(opts.ready as string)).toBeTruthy());
  if (opts?.after) await opts.after();
  expect(collectTexts().length).toBeGreaterThan(0);
  expect(r.leftover({ allow: [...DATA, ...(opts?.allow ?? [])] })).toEqual([]);
  return r;
}

describe.each(SWEEP_LOCALES)("File requests in %s", (locale) => {
  it("the list with limits, expiry and a closed untitled request", async () => {
    await expectClean(locale, wrap(<RequestsScreen />), { ready: "request-fr_1" });
  });

  it("the empty list and the failed load", async () => {
    (listRequests as jest.Mock).mockResolvedValue([]);
    const empty = await expectClean(locale, wrap(<RequestsScreen />), { ready: "requests-empty" });
    empty.unmount();
    (listRequests as jest.Mock).mockRejectedValue(new Error("offline"));
    await expectClean(locale, wrap(<RequestsScreen />), { ready: "requests-error" });
  });

  it("the create sheet, its password error and invite chips", async () => {
    await expectClean(
      locale,
      <CreateRequestSheet visible busy={false} resultUrl={null} onSubmit={() => {}} onClose={() => {}} onCopyResult={() => {}} />,
      {
        after: () => {
          fireEvent.changeText(screen.getByTestId("create-password"), "abc");
          fireEvent.changeText(screen.getByTestId("create-emails"), "x@y.z");
          fireEvent.press(screen.getByTestId("create-email-add"));
          fireEvent.press(screen.getByTestId("create-submit"));
        },
        allow: ["x@y.z"],
      },
    );
    expect(screen.getByTestId("create-password-error")).toBeTruthy();
  });

  it("the create sheet result", async () => {
    await expectClean(
      locale,
      <CreateRequestSheet visible busy={false} resultUrl="https://dosya.dev/upload-request/new" onSubmit={() => {}} onClose={() => {}} onCopyResult={() => {}} />,
    );
  });

  it("creating with invites toasts the count", async () => {
    await renderInLocale(wrap(<RequestsScreen />), locale);
    fireEvent.press(screen.getByTestId("requests-new"));
    fireEvent.changeText(screen.getByTestId("create-emails"), "x@y.z");
    fireEvent.press(screen.getByTestId("create-email-add"));
    fireEvent.press(screen.getByTestId("create-submit"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish([String(mockToast.mock.calls[0][0])], locale)).toEqual([]);
    expect(mockToast.mock.calls[0][0]).not.toBe("Invited 1 person");
  });

  it("the detail screen with uploads, recipients and manage", async () => {
    await expectClean(locale, wrap(<RequestDetailScreen />), { ready: "detail-link" });
  });

  it("the detail screen: edit form, close and remove dialogs", async () => {
    for (const id of ["detail-edit", "detail-close", "recipient-rcp_1-remove"]) {
      const r = await expectClean(locale, wrap(<RequestDetailScreen />), {
        ready: "detail-link",
        after: () => { fireEvent.press(screen.getByTestId(id)); },
      });
      r.unmount();
    }
  });

  it("the detail screen of a closed request, and a failed load", async () => {
    (listUploads as jest.Mock).mockResolvedValue({ request: request({ is_revoked: 1, expires_at: null }), uploads: [] });
    (listRecipients as jest.Mock).mockResolvedValue([]);
    const closed = await expectClean(locale, wrap(<RequestDetailScreen />), { ready: "detail-link" });
    closed.unmount();
    (listUploads as jest.Mock).mockRejectedValue(new Error("offline"));
    await expectClean(locale, wrap(<RequestDetailScreen />), { ready: "detail-error" });
  });
});
