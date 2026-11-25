/**
 * Unit H (file requests, family, teams and groups) in the chosen language:
 * every owned screen, sheet and dialog in Turkish with no leftover English, a
 * switch while mounted, the plurals in Polish for 1, 3 and 5, and the approved
 * rewordings in English.
 */
import type { ReactElement } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetI18nForTests, useLocale } from "@/lib/i18n";
import { collectTexts, leftoverEnglish, renderInLocale } from "../../../test-utils/i18n-sweep";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { toast } from "@/ui/toast";
import { listRequests, createRequest, listUploads, listRecipients } from "@/requests/api";
import { describeLimits, destinationLabel, statusLabel, validatePassword } from "@/requests/status";
import { useFamily } from "@/family/hooks";
import { getTeam, getRoles } from "@/workspace/api";
import { getGroups, createGroup, deleteGroup } from "@/groups/api";
import { CreateRequestSheet } from "@/requests/CreateRequestSheet";
import { AddToGroupSheet } from "@/groups/AddToGroupSheet";
import { FamilyUsage } from "@/family/FamilyUsage";
import { buildPeople } from "@/family/people";
import RequestsScreen from "../../../app/file-requests/index";
import RequestDetailScreen from "../../../app/file-requests/[id]";
import FamilyScreen from "../../../app/family";
import TeamsScreen from "../../../app/teams";
import GroupsScreen from "../../../app/groups";

function mockRouterModule(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../test-utils/i18n-sweep").routerMockWithTitles();
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
jest.mock("@/family/hooks", () => ({ FAMILY_KEY: ["family"], useFamily: jest.fn() }));
jest.mock("@/family/api", () => ({
  inviteFamilyMember: jest.fn(),
  leaveFamily: jest.fn(),
  removeFamilyMember: jest.fn(),
  revokeFamilyInvite: jest.fn(),
}));
jest.mock("@/workspace/api", () => ({
  getTeam: jest.fn(),
  getRoles: jest.fn(),
  inviteToWorkspace: jest.fn(),
  removeMember: jest.fn(),
  changeMemberRole: jest.fn(),
}));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, permissions: null }),
}));
jest.mock("@/groups/api", () => ({
  getGroups: jest.fn(),
  createGroup: jest.fn(),
  deleteGroup: jest.fn(),
  addFolderToGroup: jest.fn(),
  addFileToGroup: jest.fn(),
}));

const mockToast = toast as jest.Mock;

// User data and server text, never translated.
const DATA = ["Brand assets", "guest@example.com", "a@b.c", "Ada Lovelace", "ada@example.com", "bob@example.com", "Grace", "Holiday", "logo.png", "Guest", "Family Pro"];
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

const FAMILY = (over: Record<string, unknown> = {}) => ({
  ok: true, role: "payer", limit: 3, included: 2, extra_places: 1, eligible: true, ineligible_reason: null,
  pool: { used_bytes: 1000, limit_bytes: 4000, used_label: "1 KB", limit_label: "4 KB" },
  plan: { id: "p", name: "Family Pro" }, payer: { name: "Ada Lovelace" },
  members: [
    { id: "m1", email: "ada@example.com", name: "Ada Lovelace", status: "active", joined_at: 1, expires_at: null },
    { id: "m2", email: "bob@example.com", name: null, status: "invited", joined_at: null, expires_at: NOW + 86400, over_free: true },
  ],
  usage: [
    { id: "m1", name: "Ada Lovelace", is_you: true, is_payer: true, used_bytes: 600, used_label: "600 B" },
    { id: "m2", name: "Grace", is_you: false, is_payer: false, used_bytes: 400, used_label: "400 B" },
  ],
  own_used_label: "5.2 GB",
  ...over,
}) as any;

const TEAM = {
  members: [
    { membership_id: "t1", user_id: "u1", name: "Ada Lovelace", email: "ada@example.com", role_id: "role_owner", joined_at: NOW - 86400 * 3, is_you: true },
    { membership_id: "t2", user_id: "u2", name: "Grace", email: "bob@example.com", role_id: "role_member", joined_at: NOW - 86400 * 2, is_you: false },
  ],
} as any;
const ROLES = { roles: [{ id: "role_member", name: "Member" }, { id: "role_admin", name: "Admin" }] } as any;
const GROUPS = [
  { id: "g1", name: "Holiday", color: "#22c55e", folders: [{ id: "a" }], files: [{ id: "b" }, { id: "c" }] },
] as any;

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  useWorkspaceStore.setState({ activeId: "w1" });
  (listRequests as jest.Mock).mockResolvedValue([request(), request({ id: "fr_2", title: null, is_revoked: 1, expires_at: null, max_files: null, allowed_extensions: null, max_file_size_bytes: null, folder_id: "x", folder_name: null })]);
  (createRequest as jest.Mock).mockResolvedValue({ url: "https://dosya.dev/upload-request/new" });
  (listUploads as jest.Mock).mockResolvedValue({ request: request(), uploads: [upload()] });
  (listRecipients as jest.Mock).mockResolvedValue([recipient(), recipient({ id: "rcp_2", email: "u@v.w", uploaded_at: NOW }), recipient({ id: "rcp_3", email: "n@o.p", sent_at: null })]);
  (useFamily as jest.Mock).mockReturnValue({ data: FAMILY(), isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
  (getTeam as jest.Mock).mockResolvedValue(TEAM);
  (getRoles as jest.Mock).mockResolvedValue(ROLES);
  (getGroups as jest.Mock).mockResolvedValue(GROUPS);
});

async function expectClean(ui: ReactElement, opts?: { allow?: string[]; after?: () => Promise<void> | void; ready?: string }) {
  const r = await renderInLocale(ui, "tr");
  if (opts?.ready) await waitFor(() => expect(screen.getByTestId(opts.ready as string)).toBeTruthy());
  if (opts?.after) await opts.after();
  expect(collectTexts().length).toBeGreaterThan(0);
  expect(r.leftover({ allow: [...DATA, ...(opts?.allow ?? [])] })).toEqual([]);
  return r;
}

describe("file requests in Turkish", () => {
  it("the list with limits, expiry and a closed untitled request", async () => {
    await expectClean(wrap(<RequestsScreen />), { ready: "request-fr_1" });
  });

  it("the empty list and the failed load", async () => {
    (listRequests as jest.Mock).mockResolvedValue([]);
    await expectClean(wrap(<RequestsScreen />), { ready: "requests-empty" });
    (listRequests as jest.Mock).mockRejectedValue(new Error("offline"));
    await expectClean(wrap(<RequestsScreen />), { ready: "requests-error" });
  });

  it("the create sheet, its password error and invite chips", async () => {
    await expectClean(
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
      <CreateRequestSheet visible busy={false} resultUrl="https://dosya.dev/upload-request/new" onSubmit={() => {}} onClose={() => {}} onCopyResult={() => {}} />,
    );
  });

  it("creating with invites toasts the count", async () => {
    await renderInLocale(wrap(<RequestsScreen />), "tr");
    fireEvent.press(screen.getByTestId("requests-new"));
    fireEvent.changeText(screen.getByTestId("create-emails"), "x@y.z");
    fireEvent.press(screen.getByTestId("create-email-add"));
    fireEvent.press(screen.getByTestId("create-submit"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish([String(mockToast.mock.calls[0][0])], "tr")).toEqual([]);
    expect(mockToast.mock.calls[0][0]).not.toBe("Invited 1 person");
  });

  it("the detail screen with uploads, recipients and manage", async () => {
    await expectClean(wrap(<RequestDetailScreen />), { ready: "detail-link" });
  });

  it("the detail screen: edit form, close and remove dialogs, closed request", async () => {
    await expectClean(wrap(<RequestDetailScreen />), {
      ready: "detail-link",
      after: () => { fireEvent.press(screen.getByTestId("detail-edit")); },
    });
    await expectClean(wrap(<RequestDetailScreen />), {
      ready: "detail-link",
      after: () => { fireEvent.press(screen.getByTestId("detail-close")); },
    });
    await expectClean(wrap(<RequestDetailScreen />), {
      ready: "detail-link",
      after: () => { fireEvent.press(screen.getByTestId("recipient-rcp_1-remove")); },
    });
    (listUploads as jest.Mock).mockResolvedValue({ request: request({ is_revoked: 1, expires_at: null }), uploads: [] });
    (listRecipients as jest.Mock).mockResolvedValue([]);
    await expectClean(wrap(<RequestDetailScreen />), { ready: "detail-link" });
  });

  it("the detail screen: failed load, add error", async () => {
    (listUploads as jest.Mock).mockRejectedValue(new Error("offline"));
    await expectClean(wrap(<RequestDetailScreen />), { ready: "detail-error" });
    (listUploads as jest.Mock).mockResolvedValue({ request: request(), uploads: [] });
    await expectClean(wrap(<RequestDetailScreen />), {
      ready: "detail-link",
      after: () => { fireEvent.press(screen.getByTestId("recipient-add")); },
    });
    expect(screen.getByTestId("recipient-add-error")).toBeTruthy();
  });

  it("the detail toasts", async () => {
    await renderInLocale(wrap(<RequestDetailScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("detail-link")).toBeTruthy());
    fireEvent.press(screen.getByTestId("detail-copy"));
    fireEvent.press(screen.getByTestId("recipients-resend-all"));
    await waitFor(() => expect(mockToast.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => String(c[0])), "tr")).toEqual([]);
  });

  it("the helpers", async () => {
    await renderInLocale(<></>, "tr");
    const texts = [
      describeLimits(request()) ?? "",
      destinationLabel(request()),
      destinationLabel(request({ folder_id: "x", folder_name: null })),
      statusLabel("closed"), statusLabel("expired"), statusLabel("full"), statusLabel("active"),
      validatePassword("abc") ?? "",
    ];
    expect(leftoverEnglish(texts, "tr")).toEqual([]);
    expect(texts[0]).not.toBe("Max 5 MB per file · 3 files · jpg, pdf only");
  });
});

describe("family in Turkish", () => {
  const family = async (data: unknown, opts?: Parameters<typeof expectClean>[1]) => {
    (useFamily as jest.Mock).mockReturnValue({ data, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
    return expectClean(wrap(<FamilyScreen />), opts);
  };

  it("the payer view with an invited member, over capacity and full", async () => {
    await family(FAMILY());
    await family(FAMILY({ over_capacity: true }));
    await family(FAMILY({ limit: 2 }));
    await family(FAMILY({ eligible: false, ineligible_reason: "free_plan" }));
    await family(FAMILY({ included: undefined }));
  });

  it("the member view, no family and the failed load", async () => {
    await family(FAMILY({ role: "member", members: null }), { ready: "family-leave" });
    await family(FAMILY({ role: "none", eligible: false, members: [] }));
    (useFamily as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn(), isRefetching: false });
    await expectClean(wrap(<FamilyScreen />));
  });

  it("the usage tab", async () => {
    await family(FAMILY(), { after: () => { fireEvent.press(screen.getByTestId("family-tab-usage")); } });
    expect(screen.getByTestId("family-usage")).toBeTruthy();
  });

  it("the usage ring on its own", async () => {
    await expectClean(<FamilyUsage view={FAMILY()} people={buildPeople(FAMILY()).people} />);
  });

  it.each([
    ["family-remove-m1"],
    ["family-remove-m2"],
    ["family-resend-m2"],
  ])("the confirm dialog opened by %s", async (id) => {
    await family(FAMILY(), { after: () => { fireEvent.press(screen.getByTestId(id)); } });
  });

  it("the leave dialog with and without usage", async () => {
    await family(FAMILY({ role: "member", members: null }), { after: () => { fireEvent.press(screen.getByTestId("family-leave")); } });
    await family(FAMILY({ role: "member", members: null, own_used_label: undefined, payer: null }), { after: () => { fireEvent.press(screen.getByTestId("family-leave")); } });
  });

  it("the invite toast", async () => {
    await family(FAMILY());
    fireEvent.changeText(screen.getByTestId("family-invite-email"), "new@example.com");
    fireEvent.press(screen.getByTestId("family-invite"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast.mock.calls[0][0]).not.toBe("Invitation sent");
  });
});

describe("teams and groups in Turkish", () => {
  it("the team list, invite card and the dialogs", async () => {
    await expectClean(wrap(<TeamsScreen />), { ready: "invite-email", allow: ["Member", "Admin", "Owner"] });
    await expectClean(wrap(<TeamsScreen />), {
      ready: "invite-email", allow: ["Member", "Admin", "Owner"],
      after: () => { fireEvent.press(screen.getByTestId("remove-t2")); },
    });
    await expectClean(wrap(<TeamsScreen />), {
      ready: "invite-email", allow: ["Member", "Admin", "Owner"],
      after: () => { fireEvent.press(screen.getByTestId("role-t2")); },
    });
  });

  it("the team failure and empty states", async () => {
    (getTeam as jest.Mock).mockRejectedValue(new Error("403"));
    await expectClean(wrap(<TeamsScreen />), { allow: ["Member", "Admin", "Owner"] });
    (getTeam as jest.Mock).mockResolvedValue({ members: [] });
    await expectClean(wrap(<TeamsScreen />), { ready: "invite-email", allow: ["Member", "Admin"] });
  });

  it("the groups screen, prompt and delete dialog, empty and failed", async () => {
    await expectClean(wrap(<GroupsScreen />), { ready: "groups-new" });
    await expectClean(wrap(<GroupsScreen />), { ready: "groups-new", after: () => { fireEvent.press(screen.getByTestId("groups-new")); } });
    await expectClean(wrap(<GroupsScreen />), { ready: "groups-new", after: () => { fireEvent.press(screen.getByTestId("group-delete-g1")); } });
    (getGroups as jest.Mock).mockResolvedValue([]);
    await expectClean(wrap(<GroupsScreen />), { ready: "groups-new" });
    (getGroups as jest.Mock).mockRejectedValue(new Error("x"));
    await expectClean(wrap(<GroupsScreen />));
  });

  it("the groups toasts", async () => {
    (createGroup as jest.Mock).mockResolvedValue({});
    (deleteGroup as jest.Mock).mockResolvedValue({});
    await renderInLocale(wrap(<GroupsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("group-delete-g1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("group-delete-g1"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish([String(mockToast.mock.calls[0][0])], "tr")).toEqual([]);
    expect(mockToast.mock.calls[0][0]).not.toBe("Deleted “Holiday”");
  });

  it("the add-to-group sheet, with groups and without", async () => {
    const sheet = <AddToGroupSheet target={{ kind: "file", id: "f1", name: "song.mp3" }} workspaceId="w1" visible onClose={() => {}} />;
    await expectClean(wrap(sheet), { allow: ["song.mp3"], ready: "add-to-group-g1" });
    (getGroups as jest.Mock).mockResolvedValue([]);
    await expectClean(wrap(sheet), { allow: ["song.mp3"], ready: "add-to-group-new" });
    await expectClean(wrap(sheet), { allow: ["song.mp3"], ready: "add-to-group-new", after: () => { fireEvent.press(screen.getByTestId("add-to-group-new")); } });
  });
});

describe("plurals in Polish for 1, 3 and 5", () => {
  it("request limits, counts and uploads", async () => {
    await renderInLocale(<></>, "pl");
    const limits = (n: number) => describeLimits(request({ max_file_size_bytes: null, allowed_extensions: null, max_files: n }));
    expect([1, 3, 5].map(limits)).toEqual(["1 plik", "3 pliki", "5 plików"]);
    expect(describeLimits(request({ max_files: null, max_file_size_bytes: null, allowed_extensions: "png" }))).toBe("png tylko");
    expect(describeLimits(request({ max_files: 3 }))).toBe("Maksymalnie 5 MB na plik · 3 pliki · jpg, pdf tylko");
  });

  it("the requests header and cards", async () => {
    const want: Record<number, [string, string]> = { 1: ["1 prośba", "1 przesłanie"], 3: ["3 prośby", "3 przesłania"], 5: ["5 próśb", "5 przesłań"] };
    for (const n of [1, 3, 5]) {
      (listRequests as jest.Mock).mockResolvedValue(Array.from({ length: n }, (_, i) => request({ id: `r${i}`, upload_count: n })));
      const r = await renderInLocale(wrap(<RequestsScreen />), "pl");
      await waitFor(() => expect(screen.getByTestId("request-r0")).toBeTruthy());
      const texts = collectTexts();
      expect(texts).toContain(want[n][0]);
      expect(texts.some((x) => x.startsWith(want[n][1]))).toBe(true);
      r.unmount();
    }
  });

  it("the invited toast", async () => {
    const want: Record<number, string> = { 1: "Zaproszono 1 osobę", 3: "Zaproszono 3 osoby", 5: "Zaproszono 5 osób" };
    for (const n of [1, 3, 5]) {
      mockToast.mockClear();
      const r = await renderInLocale(wrap(<RequestsScreen />), "pl");
      fireEvent.press(screen.getByTestId("requests-new"));
      for (let i = 0; i < n; i++) {
        fireEvent.changeText(screen.getByTestId("create-emails"), `p${i}@example.com`);
        fireEvent.press(screen.getByTestId("create-email-add"));
      }
      fireEvent.press(screen.getByTestId("create-submit"));
      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(want[n]));
      r.unmount();
    }
  });

  it("group rows and sheet item counts", async () => {
    const mk = (nf: number, nfi: number) => ({ id: "g", name: "Holiday", color: "#000", folders: Array.from({ length: nf }, (_, i) => ({ id: `f${i}` })), files: Array.from({ length: nfi }, (_, i) => ({ id: `x${i}` })) });
    const want: Record<number, string> = { 1: "1 folder · 1 plik", 3: "3 foldery · 3 pliki", 5: "5 folderów · 5 plików" };
    for (const n of [1, 3, 5]) {
      (getGroups as jest.Mock).mockResolvedValue([mk(n, n)]);
      const r = await renderInLocale(wrap(<GroupsScreen />), "pl");
      await waitFor(() => expect(screen.getByTestId("group-g")).toBeTruthy());
      expect(collectTexts()).toContain(want[n]);
      r.unmount();
    }
    const items: Record<number, string> = { 1: "1 element", 3: "3 elementy", 5: "5 elementów" };
    for (const n of [1, 3, 5]) {
      (getGroups as jest.Mock).mockResolvedValue([mk(0, n)]);
      const r = await renderInLocale(wrap(<AddToGroupSheet target={{ kind: "file", id: "f", name: "s.mp3" }} workspaceId="w1" visible onClose={() => {}} />), "pl");
      await waitFor(() => expect(screen.getByTestId("add-to-group-g")).toBeTruthy());
      expect(collectTexts()).toContain(items[n]);
      r.unmount();
    }
  });
});

describe("group counts keep each language's own text", () => {
  const mk = (n: number) => ({ id: "g", name: "Holiday", color: "#000", folders: Array.from({ length: n }, (_, i) => ({ id: `f${i}` })), files: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })) });
  const render = async (locale: "it" | "en" | "tr", n: number) => {
    (getGroups as jest.Mock).mockResolvedValue([mk(n)]);
    const r = await renderInLocale(wrap(<GroupsScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("group-g")).toBeTruthy());
    const texts = collectTexts();
    r.unmount();
    return texts;
  };
  it("Italian is exactly the it.json text", async () => {
    expect(await render("it", 1)).toContain("1 cartella · 1 file");
    expect(await render("it", 3)).toContain("3 cartelle · 3 file");
  });
  it("English shows files, Turkish is unchanged", async () => {
    expect(await render("en", 3)).toContain("3 folders · 3 files");
    expect(await render("en", 1)).toContain("1 folder · 1 file");
    expect(await render("tr", 3)).toContain("3 klasör · 3 dosya");
  });
});

describe("switching the language while mounted", () => {
  function Probe({ to }: { to: "de" }) {
    const { setPreference } = useLocale();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pressable } = require("react-native");
    return <Pressable testID="switch-language" onPress={() => void setPreference(to)} />;
  }

  it("the groups screen follows", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><GroupsScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("groups-new")).toBeTruthy());
    expect(collectTexts()).toContain("1 folder · 2 files");
    fireEvent.press(screen.getByTestId("switch-language"));
    await waitFor(() => expect(screen.queryByText("New group")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: DATA })).toEqual([]);
  });

  it("the requests list and the create sheet follow", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><RequestsScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("request-fr_1")).toBeTruthy());
    expect(collectTexts()).toContain("Max 5 MB per file · 3 files · jpg, pdf only");
    fireEvent.press(screen.getByTestId("switch-language"));
    await waitFor(() => expect(screen.queryByText("Max 5 MB per file · 3 files · jpg, pdf only")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: DATA })).toEqual([]);
  });

  it("the family screen follows", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><FamilyScreen /></>), "en");
    expect(screen.getByText("Invite")).toBeTruthy();
    fireEvent.press(screen.getByTestId("switch-language"));
    await waitFor(() => expect(screen.queryByText("Invite")).toBeNull());
    expect(leftoverEnglish(collectTexts(), "de", { allow: DATA })).toEqual([]);
  });

  it("the team screen follows", async () => {
    await renderInLocale(wrap(<><Probe to="de" /><TeamsScreen /></>), "en");
    await waitFor(() => expect(screen.getByTestId("invite-email")).toBeTruthy());
    expect(screen.getByText("Send invite")).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId("switch-language")); });
    await waitFor(() => expect(screen.queryByText("Send invite")).toBeNull());
  });
});

describe("English stays as it was, except the approved rewordings", () => {
  it("the file requests list and detail read as before", async () => {
    await renderInLocale(wrap(<RequestsScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("request-fr_1")).toBeTruthy());
    const texts = collectTexts();
    expect(texts).toContain("2 requests");
    expect(texts).toContain("File requests");
    expect(texts).toContain("Max 5 MB per file · 3 files · jpg, pdf only");
    expect(texts).toContain("1 upload · Workspace root");
    expect(texts.some((x) => /^· expires /.test(x))).toBe(true);
  });

  it("the detail screen", async () => {
    await renderInLocale(wrap(<RequestDetailScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("detail-link")).toBeTruthy());
    const texts = collectTexts();
    expect(texts).toContain("Uploads land in Workspace root");
    expect(texts.some((x) => /^· expires /.test(x))).toBe(true);
    expect(texts).toContain("Uploads (1)");
    expect(texts).toContain("Recipients (3)");
    expect(texts).toContain("Resend all (2)");
    expect(texts).toContain("Not sent yet");
  });

  it("family strings keep their wording", async () => {
    await renderInLocale(wrap(<FamilyScreen />), "en");
    const texts = collectTexts();
    expect(texts).toContain("2 of 3 places used (2 included, 1 extra)");
    expect(texts).toContain("1 KB of 4 KB used across the family.");
    expect(texts).toContain("expires " + new Date((NOW + 86400) * 1000).toLocaleDateString());
    expect(texts).toContain("Remove Ada Lovelace");
    expect(texts).toContain("Revoke invitation to bob@example.com");
    fireEvent.press(screen.getByTestId("family-remove-m2"));
    expect(collectTexts()).toContain("Revoke the invitation to bob@example.com?");
  });

  it("the remove-member dialog is one message with the over-free tail", async () => {
    await renderInLocale(wrap(<FamilyScreen />), "en");
    (useFamily as jest.Mock).mockReturnValue({ data: FAMILY({ members: [{ id: "m3", email: "z@example.com", name: null, status: "active", joined_at: 1, expires_at: null, over_free: true }] }), isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
    __resetI18nForTests();
    await renderInLocale(wrap(<FamilyScreen />), "en");
    fireEvent.press(screen.getByTestId("family-remove-m3"));
    expect(collectTexts()).toContain("Their account returns to the free plan with 5 GB. Nothing is deleted, and you can invite them again later. They currently store more than 5 GB, so their uploads will pause until they free space.");
  });

  it("the error line reads Could not load (approved rewording)", async () => {
    (useFamily as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn(), isRefetching: false });
    await renderInLocale(wrap(<FamilyScreen />), "en");
    expect(screen.getByText("Could not load your family plan.")).toBeTruthy();
  });

  it("groups: 'No groups yet' and the count line", async () => {
    (getGroups as jest.Mock).mockResolvedValue([]);
    await renderInLocale(wrap(<GroupsScreen />), "en");
    await waitFor(() => expect(screen.getByText("No groups yet")).toBeTruthy());
  });

  it("the add-to-group sheet reads 'New group' without an ellipsis", async () => {
    await renderInLocale(wrap(<AddToGroupSheet target={{ kind: "file", id: "f1", name: "song.mp3" }} workspaceId="w1" visible onClose={() => {}} />), "en");
    await waitFor(() => expect(screen.getByTestId("add-to-group-g1")).toBeTruthy());
    expect(screen.getByText("New group")).toBeTruthy();
    expect(screen.getByText("Add song.mp3 to group")).toBeTruthy();
    expect(screen.getByText("3 items")).toBeTruthy();
  });

  it("teams strings", async () => {
    await renderInLocale(wrap(<TeamsScreen />), "en");
    await waitFor(() => expect(screen.getByTestId("invite-email")).toBeTruthy());
    const texts = collectTexts();
    expect(texts).toContain("Invite to workspace");
    expect(texts).toContain("Invite as Member");
    expect(texts).toContain("Change role for Grace");
    expect(texts).toContain("Remove Grace");
    expect(texts.some((x) => /^bob@example\.com · joined /.test(x))).toBe(true);
  });
});
