import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MySharesScreen from "./index";
import * as shareHooks from "@/share/hooks";
import * as filesHooks from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import type { MyShare, SharedWithMe } from "@/share/types";
import { Linking } from "react-native";

// Named with the `mock` prefix jest's hoisting requires: the factory is lifted
// above the file's own declarations, so a plain `const push` is not in scope yet.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: jest.fn() }));

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>;

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

function link(over: Partial<MyShare> = {}): MyShare {
  return {
    link_id: "l1", token: "t1", url: "https://dosya.dev/s/t1",
    display_name: "a.txt", file_id: "f1", file_name: "a.txt",
    folder_id: null, folder_name: null, is_folder: false, is_bundle: 0,
    size_bytes: 100, extension: "txt", region: "weur",
    is_password_protected: 0, lock_mode: "none", access_mode: "public", recipient_count: 0,
    is_revoked: 0, revoked_at: null, expires_at: null,
    view_count: 2, download_count: 1, max_downloads: null, shared_at: now - DAY,
    created_by: "u1", sharer_name: "Me", status: "active", is_mine: true,
    ...over,
  };
}

const revoke = { mutate: jest.fn() };

function withMeRow(over: Partial<SharedWithMe> = {}): SharedWithMe {
  return {
    link_id: "wm1", url: "https://dosya.dev/s/wtok", display_name: "brief.pdf",
    is_folder: false, is_bundle: false, size_bytes: 2048, extension: "pdf",
    is_password_protected: 0, lock_mode: "none",
    expires_at: null, revoked_at: null, status: "active",
    shared_at: now - DAY, invited_at: now - DAY,
    verified_at: null, sender_name: "Dana",
    ...over,
  };
}

function mockWithMe(links: SharedWithMe[], emailVerified = true) {
  jest.spyOn(shareHooks, "useSharedWithMe").mockReturnValue({
    data: {
      links,
      emailVerified,
      stats: { total: links.length, active: links.filter((l) => l.status === "active").length, unopened: links.filter((l) => !l.verified_at).length },
    },
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  } as never);
}

function mockShares(links: MyShare[]) {
  jest.spyOn(shareHooks, "useMyShares").mockReturnValue({
    data: {
      links,
      stats: {
        total: links.length,
        active: links.filter((l) => l.status === "active").length,
        expiring: links.filter((l) => l.status === "expiring").length,
        total_views: links.reduce((s, l) => s + l.view_count, 0),
      },
    },
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  } as never);
}

describe("MySharesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWorkspaceStore as unknown as jest.Mock).mockImplementation(
      (selector: (s: { activeId: string | null }) => unknown) => selector({ activeId: "w1" }),
    );
    jest.spyOn(filesHooks, "useWorkspaces").mockReturnValue({ data: [{ id: "w1" }] } as never);
    jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
      createLink: {}, email: {}, revoke, createFolderLink: {}, folderEmail: {}, update: {},
    } as never);
    mockWithMe([]);
    // Spied rather than jest.mock'd: the internal module path moves between RN
    // versions, and the public export is what the screen actually calls.
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  });

  let openURL: jest.SpyInstance;

  it("lists a link with its name and counters", () => {
    mockShares([link()]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByText("a.txt")).toBeTruthy();
  });

  // The endpoint has always returned `stats`; the previous screen dropped it.
  it("shows the workspace counters the endpoint sends", () => {
    mockShares([link({ status: "active", view_count: 5 }), link({ link_id: "l2", status: "expiring", view_count: 3 })]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByTestId("stat-views")).toHaveTextContent("8");
    expect(screen.getByTestId("stat-expiring")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-total")).toHaveTextContent("2");
  });

  it("filters by status", () => {
    mockShares([link({ display_name: "live.txt" }), link({ link_id: "l2", display_name: "dead.txt", status: "revoked", is_revoked: 1 })]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByText("dead.txt")).toBeTruthy();

    fireEvent.press(screen.getByTestId("filter-active"));
    expect(screen.queryByText("dead.txt")).toBeNull();
    expect(screen.getByText("live.txt")).toBeTruthy();
  });

  it("searches by name", () => {
    mockShares([link({ display_name: "budget.xlsx" }), link({ link_id: "l2", display_name: "photo.png" })]);
    render(wrap(<MySharesScreen />));
    fireEvent.changeText(screen.getByTestId("share-search"), "budget");
    expect(screen.getByText("budget.xlsx")).toBeTruthy();
    expect(screen.queryByText("photo.png")).toBeNull();

    fireEvent.press(screen.getByTestId("clear-search"));
    expect(screen.getByText("photo.png")).toBeTruthy();
  });

  it("opens the detail screen when a row is tapped", () => {
    mockShares([link()]);
    render(wrap(<MySharesScreen />));
    fireEvent.press(screen.getByTestId("share-row-l1"));
    expect(mockPush).toHaveBeenCalledWith("/shares/l1");
  });

  it("confirms before revoking rather than killing a link on one tap", () => {
    mockShares([link()]);
    render(wrap(<MySharesScreen />));
    fireEvent.press(screen.getByTestId("revoke-l1"));
    expect(revoke.mutate).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("confirm"));
    expect(revoke.mutate).toHaveBeenCalledWith("l1");
  });

  it("offers no copy or revoke on a link that already stopped working", () => {
    mockShares([link({ status: "revoked", is_revoked: 1 })]);
    render(wrap(<MySharesScreen />));
    expect(screen.queryByTestId("revoke-l1")).toBeNull();
    expect(screen.queryByTestId("copy-l1")).toBeNull();
  });

  it("says a link never expires rather than leaving the row silent", () => {
    mockShares([link({ expires_at: null })]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByText(/Never expires/)).toBeTruthy();
  });

  it("counts down a link that is about to stop working", () => {
    mockShares([link({ status: "expiring", expires_at: now + 2 * DAY + 60 })]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByText(/2 days left/)).toBeTruthy();
  });

  // The row's whole security posture used to be invisible: the endpoint sends
  // all four of these fields and the list rendered none of them.
  it("marks a protected, restricted, view-only link on the row itself", () => {
    mockShares([link({ is_password_protected: 1, access_mode: "restricted", recipient_count: 2, lock_mode: "view_only" })]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByLabelText("Password required")).toBeTruthy();
    expect(screen.getByLabelText("Only invited people")).toBeTruthy();
    expect(screen.getByLabelText("View only, no downloads")).toBeTruthy();
  });

  it("names who shared a link that is not yours", () => {
    mockShares([link({ is_mine: false, sharer_name: "Dana" })]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByText(/by Dana/)).toBeTruthy();
  });

  it("explains the empty state instead of showing a bare line", () => {
    mockShares([]);
    render(wrap(<MySharesScreen />));
    expect(screen.getByText("Nothing shared yet")).toBeTruthy();
  });

  it("distinguishes an empty filter from an empty workspace", () => {
    mockShares([link({ status: "active" })]);
    render(wrap(<MySharesScreen />));
    fireEvent.press(screen.getByTestId("filter-revoked"));
    expect(screen.getByText("No links with this status")).toBeTruthy();
  });

  /**
   * The tab that had no query behind it. /api/shares lists by workspace and
   * creator; "pointed at me" needed GET /api/shares/with-me.
   */
  describe("shared with me", () => {
    function openTab() {
      fireEvent.press(screen.getByTestId("shares-tab-with-me"));
    }

    it("lists a link somebody sent you, with who sent it", () => {
      mockShares([]);
      mockWithMe([withMeRow()]);
      render(wrap(<MySharesScreen />));
      openTab();
      expect(screen.getByText("brief.pdf")).toBeTruthy();
      expect(screen.getByText(/From Dana/)).toBeTruthy();
    });

    it("swaps the list rather than merging the two", () => {
      mockShares([link({ display_name: "mine.txt" })]);
      mockWithMe([withMeRow()]);
      render(wrap(<MySharesScreen />));
      expect(screen.getByText("mine.txt")).toBeTruthy();
      openTab();
      expect(screen.queryByText("mine.txt")).toBeNull();
      expect(screen.getByText("brief.pdf")).toBeTruthy();
    });

    it("says whether YOU have opened it", () => {
      mockShares([]);
      mockWithMe([withMeRow({ verified_at: null })]);
      render(wrap(<MySharesScreen />));
      openTab();
      expect(screen.getByText("New")).toBeTruthy();
    });

    it("offers no revoke, because it is not your link", () => {
      mockShares([]);
      mockWithMe([withMeRow()]);
      render(wrap(<MySharesScreen />));
      openTab();
      expect(screen.queryByTestId("revoke-wm1")).toBeNull();
    });

    it("opens the link when a live row is tapped", () => {
      mockShares([]);
      mockWithMe([withMeRow()]);
      render(wrap(<MySharesScreen />));
      openTab();
      fireEvent.press(screen.getByTestId("with-me-row-wm1"));
      expect(openURL).toHaveBeenCalledWith("https://dosya.dev/s/wtok");
    });

    it("does not try to open a link that has stopped working", () => {
      mockShares([]);
      mockWithMe([withMeRow({ status: "revoked" })]);
      render(wrap(<MySharesScreen />));
      openTab();
      fireEvent.press(screen.getByTestId("with-me-row-wm1"));
      expect(openURL).not.toHaveBeenCalled();
    });

    // Empty BY RULE, which is a different thing from "nobody sent you anything".
    it("explains an unverified address instead of showing an empty list", () => {
      mockShares([]);
      mockWithMe([], false);
      render(wrap(<MySharesScreen />));
      openTab();
      expect(screen.getByText("Verify your email to see these")).toBeTruthy();
    });

    it("has its own empty state", () => {
      mockShares([]);
      mockWithMe([]);
      render(wrap(<MySharesScreen />));
      openTab();
      expect(screen.getByText("Nothing shared with you")).toBeTruthy();
    });
  });
});
