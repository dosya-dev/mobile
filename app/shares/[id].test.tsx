import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ShareDetailScreen from "./[id]";
import * as shareHooks from "@/share/hooks";
import type { ShareAnalytics } from "@/share/types";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "l1" }),
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>;

const now = Math.floor(Date.now() / 1000);
const revoke = { mutate: jest.fn() };
const update = { mutate: jest.fn(), isPending: false };

function analytics(over: Partial<ShareAnalytics> = {}, linkOver: Partial<ShareAnalytics["link"]> = {}): ShareAnalytics {
  return {
    link: {
      link_id: "l1", url: "https://dosya.dev/s/tok", display_name: "Q3.pdf",
      is_folder: false, is_bundle: false, file_id: "f1", size_bytes: 2048,
      extension: "pdf", region: "weur", created_at: now - 86400 * 6,
      created_by: "u1", created_by_name: "Me", is_mine: true,
      expires_at: null, is_revoked: false, revoked_at: null,
      is_password_protected: false, lock_mode: "none", access_mode: "public",
      status: "active", view_count: 86, download_count: 12,
      max_downloads: null, downloads_left: null,
      ...linkOver,
    },
    range: 30,
    timeline: [{ day: "2026-09-01", opens: 4, downloads: 1 }, { day: "2026-09-02", opens: 9, downloads: 3 }],
    reach: { visitors: 14, truncated: false, devices: [], browsers: [] },
    recipients: null,
    log: {
      total: 2, offset: 0, limit: 50,
      rows: [
        { id: "e1", visitor: "a4f81c02", event: "download", device: "mobile", device_label: "iPhone", country: "nl", viewed_at: now - 7200 },
        { id: "e2", visitor: "7b20de55", event: "view", device: "desktop", device_label: "Mac", country: null, viewed_at: now - 86400 },
      ],
    },
    gaps: { repeat_visits: "a returning visitor is deduped by ip_hash", per_recipient: null },
    ...over,
  };
}

function mockAnalytics(a: ShareAnalytics | null, state: { isLoading?: boolean; isError?: boolean } = {}) {
  jest.spyOn(shareHooks, "useShareAnalytics").mockReturnValue({
    data: a ?? undefined,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isRefetching: false,
    refetch: jest.fn(),
  } as never);
}

describe("ShareDetailScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
      createLink: {}, email: {}, revoke, createFolderLink: {}, folderEmail: {}, update,
    } as never);
  });

  it("leads with a plain sentence, not the chart", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "14 people opened this link, and it has 12 downloads. Anyone holding the link can open it.",
    );
  });

  it("shows the three counters the endpoint already returns", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByTestId("stat-opens")).toHaveTextContent("86");
    expect(screen.getByTestId("stat-downloads")).toHaveTextContent("12");
    expect(screen.getByTestId("stat-people")).toHaveTextContent("14");
  });

  it("draws the access log with device and country", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText("Downloaded")).toBeTruthy();
    expect(screen.getByText(/a4f81c02 · iPhone · NL/)).toBeTruthy();
    // A missing country is dashed, never guessed.
    expect(screen.getByText(/7b20de55 · Mac · -/)).toBeTruthy();
  });

  it("switches the range, which refetches under a different key", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    fireEvent.press(screen.getByTestId("range-7"));
    expect(shareHooks.useShareAnalytics).toHaveBeenLastCalledWith("l1", 7);
  });

  it("repeats what the numbers cannot tell you, in the API's own words", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText(/deduped by ip_hash/)).toBeTruthy();
  });

  it("lists invited people and who has actually opened it", () => {
    mockAnalytics(analytics(
      { recipients: [
        { email: "dana@northfield.co", verified_at: now - 100, invited_at: now - 200 },
        { email: "m.okafor@northfield.co", verified_at: null, invited_at: now - 200 },
      ] },
      { access_mode: "restricted" },
    ));
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText("1 of 2 opened")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Not opened")).toBeTruthy();
  });

  it("shows no recipient panel for a public link", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    expect(screen.queryByText("Invited")).toBeNull();
  });

  it("reports view-only in the settings rather than implying downloads work", () => {
    mockAnalytics(analytics({}, { lock_mode: "view_only" }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText("Off - view only")).toBeTruthy();
  });

  it("confirms before revoking, then goes back once it is gone", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    fireEvent.press(screen.getByTestId("revoke-link"));
    expect(revoke.mutate).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("confirm"));
    expect(revoke.mutate).toHaveBeenCalledWith("l1", expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("offers no edit or revoke on a link that is already revoked", () => {
    mockAnalytics(analytics({}, { is_revoked: true, status: "revoked" }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.queryByTestId("revoke-link")).toBeNull();
    expect(screen.queryByTestId("edit-link")).toBeNull();
  });

  it("says a revoked link's figures are final", () => {
    mockAnalytics(analytics({}, { is_revoked: true, status: "revoked" }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByTestId("summary")).toHaveTextContent(/It cannot be opened again\./);
  });

  it("shows an empty chart state instead of dividing by a zero peak", () => {
    mockAnalytics(analytics({ timeline: [], reach: { visitors: 0, truncated: false, devices: [], browsers: [] } }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText("No opens in this range")).toBeTruthy();
    expect(screen.queryByTestId("timeline-chart")).toBeNull();
  });

  it("explains a link it cannot load rather than showing an empty screen", () => {
    mockAnalytics(null, { isError: true });
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText("This link is not available")).toBeTruthy();
  });

  it("reports how much of a download limit is used", () => {
    mockAnalytics(analytics({}, { max_downloads: 5, download_count: 2, downloads_left: 3 }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByText("2 of 5 used")).toBeTruthy();
  });

  // The counters alone do not say "this stopped working" - 5 of 5 reads as
  // success unless something names the consequence.
  it("says out loud when a link has spent its downloads", () => {
    mockAnalytics(analytics({}, { max_downloads: 5, download_count: 5, downloads_left: 0 }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.getByTestId("cap-spent")).toBeTruthy();
  });

  it("does not warn about a limit on an uncapped link", () => {
    mockAnalytics(analytics());
    render(wrap(<ShareDetailScreen />));
    expect(screen.queryByTestId("cap-spent")).toBeNull();
    expect(screen.getByText("Allowed")).toBeTruthy();
  });

  it("does not double up the warning on a revoked link", () => {
    mockAnalytics(analytics({}, { max_downloads: 5, download_count: 5, downloads_left: 0, is_revoked: true, status: "revoked" }));
    render(wrap(<ShareDetailScreen />));
    expect(screen.queryByTestId("cap-spent")).toBeNull();
  });
});
