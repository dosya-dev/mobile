import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { toast } from "@/ui/toast";
import { AiSearchSection } from "./AiSearchSection";
import { fetchFolderTree, fetchWorkspaceAiSearch, updateWorkspaceAiSearch, type AiSearchSettingsResponse } from "./api";

jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("./api", () => {
  const actual = jest.requireActual("./api");
  return { ...actual, fetchWorkspaceAiSearch: jest.fn(), updateWorkspaceAiSearch: jest.fn(), fetchFolderTree: jest.fn() };
});

const mockFetch = fetchWorkspaceAiSearch as jest.MockedFunction<typeof fetchWorkspaceAiSearch>;
const mockUpdate = updateWorkspaceAiSearch as jest.MockedFunction<typeof updateWorkspaceAiSearch>;
const mockTree = fetchFolderTree as jest.MockedFunction<typeof fetchFolderTree>;

const LIMITS = { vectorBudget: 1, imagesMax: 1000, documentsMax: 200, docChunksMax: 1, backfillUnits: 10, monthUnits: 5 };

function resp(over: { enabled?: boolean; can_edit?: boolean; limits?: typeof LIMITS | null; excluded?: string[]; paused?: boolean } = {}): AiSearchSettingsResponse {
  return {
    ok: true,
    can_edit: over.can_edit ?? true,
    settings: { enabled: over.enabled ?? false, index_existing: true, excluded_folders: over.excluded ?? [] },
    status: {
      files_total: 50, indexed: 1234, pending: 7, partial: 0, unsupported: 0, capped: 0, failed: 0, images: 300, documents: 20, chunks: 40,
      limits: over.limits === undefined ? LIMITS : over.limits, backfill_units_remaining: 5, month_units_remaining: 5,
      month_reset_at: null, estimated_finish_at: null, paused: over.paused ?? false,
    },
  };
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><AiSearchSection workspaceId="w1" /></QueryClientProvider>);
}

beforeEach(() => { jest.clearAllMocks(); mockTree.mockResolvedValue([]); });

it("renders nothing when the settings cannot be read", async () => {
  mockFetch.mockResolvedValueOnce(null);
  renderSection();
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(screen.queryByTestId("ai-search-section")).toBeNull();
});

it("lets an owner switch it on", async () => {
  mockFetch.mockResolvedValue(resp());
  mockUpdate.mockResolvedValueOnce({ enabled: true, index_existing: true, excluded_folders: [] });
  renderSection();
  fireEvent(await screen.findByTestId("ai-search-enabled"), "valueChange", true);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("w1", { enabled: true }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Saved"));
});

it("disables the switch without the plan and says why", async () => {
  mockFetch.mockResolvedValue(resp({ limits: null }));
  renderSection();
  expect((await screen.findByTestId("ai-search-enabled")).props.disabled).toBe(true);
  expect(screen.getByText("AI search is available on paid plans")).toBeTruthy();
});

it("keeps switching off possible after a downgrade", async () => {
  mockFetch.mockResolvedValue(resp({ limits: null, enabled: true }));
  renderSection();
  expect((await screen.findByTestId("ai-search-enabled")).props.disabled).toBe(false);
});

it("shows the server's refusal as its message", async () => {
  mockFetch.mockResolvedValue(resp());
  mockUpdate.mockRejectedValueOnce(new ApiError("rate_limited", 429));
  renderSection();
  fireEvent(await screen.findByTestId("ai-search-enabled"), "valueChange", true);
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Too many changes. Try again in a minute.", "error"));
});

it("shows the indexing status and a pause once enabled", async () => {
  mockFetch.mockResolvedValue(resp({ enabled: true, paused: true }));
  renderSection();
  expect(await screen.findByTestId("ai-search-status")).toBeTruthy();
  expect(screen.getByText("1,234")).toBeTruthy();
  expect(screen.getByText("300 of 1,000")).toBeTruthy();
  expect(screen.getByTestId("ai-search-paused")).toBeTruthy();
});

it("adds a folder from the picker and names excluded folders", async () => {
  mockFetch.mockResolvedValue(resp({ enabled: true, excluded: ["f1"] }));
  mockTree.mockResolvedValue([
    { id: "f1", name: "Private", parent_id: null },
    { id: "f2", name: "Scans", parent_id: null },
  ]);
  mockUpdate.mockResolvedValueOnce({ enabled: true, index_existing: true, excluded_folders: ["f1", "f2"] });
  renderSection();
  expect(await screen.findByText("Private")).toBeTruthy();
  fireEvent.press(screen.getByTestId("ai-search-add-folder"));
  // Already excluded folders are not offered again.
  expect(screen.queryByTestId("ai-search-pick-f1")).toBeNull();
  fireEvent.press(await screen.findByTestId("ai-search-pick-f2"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("w1", { excluded_folders: ["f1", "f2"] }));
});

it("is read-only without permission", async () => {
  mockFetch.mockResolvedValue(resp({ enabled: true, can_edit: false }));
  renderSection();
  expect((await screen.findByTestId("ai-search-enabled")).props.disabled).toBe(true);
  expect(screen.getByText("You don't have permission to change AI search")).toBeTruthy();
});
