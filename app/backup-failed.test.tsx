const mockListByStatus = jest.fn();
const mockCountByStatus = jest.fn();
const mockResetForRetry = jest.fn(async (..._a: unknown[]) => 0);
const mockRunBackup = jest.fn(async (..._a: unknown[]) => ({}));
const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("@/backup/ledger", () => ({
  listByStatus: (...a: unknown[]) => mockListByStatus(...a),
  countByStatus: (...a: unknown[]) => mockCountByStatus(...a),
  resetForRetry: (...a: unknown[]) => mockResetForRetry(...a),
}));
jest.mock("@/backup/orchestrator", () => ({ runBackup: (...a: unknown[]) => mockRunBackup(...a) }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ back: mockBack, push: mockPush }) }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import BackupFailed from "./backup-failed";
import { useWorkspaceStore } from "@/files/workspaceStore";

const row = (over: Record<string, unknown>) => ({
  workspace_id: "w1", local_id: "a", filename: "IMG_1.HEIC", size: 4_100_000,
  created_at: 1, fingerprint: null, status: "error", remote_file_id: null,
  attempts: 5, last_error: "iCloud original unavailable", mp_session: null, ...over,
});

const ZERO_COUNTS = { pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 0 };

/** `n` failures, each one identifiable by its filename. */
const rows = (n: number, status = "error") =>
  Array.from({ length: n }, (_, i) =>
    row({ local_id: `id_${i}`, filename: `IMG_${i}.HEIC`, status }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockListByStatus.mockResolvedValue([]);
  mockCountByStatus.mockResolvedValue(ZERO_COUNTS);
  mockResetForRetry.mockResolvedValue(0);
  useWorkspaceStore.setState({ activeId: "w1" } as never);
});

describe("BackupFailed", () => {
  it("lists each failure with its size and reason", async () => {
    mockListByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
      statuses.includes("error") ? [row({})] : [],
    );
    render(<BackupFailed />);
    expect(await screen.findByText("IMG_1.HEIC")).toBeTruthy();
    expect(screen.getByText(/iCloud original unavailable/)).toBeTruthy();
  });

  it("retries every failure and starts a run", async () => {
    mockListByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
      statuses.includes("error") ? [row({})] : [],
    );
    mockResetForRetry.mockResolvedValue(1);
    render(<BackupFailed />);
    fireEvent.press(await screen.findByTestId("retry-all"));
    await waitFor(() => expect(mockResetForRetry).toHaveBeenCalledWith("w1"));
    // Resetting alone changes nothing visible - the run is what re-uploads.
    await waitFor(() => expect(mockRunBackup).toHaveBeenCalledWith("w1"));
  });

  it("pages the failures instead of stacking every one of them", async () => {
    mockListByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
      statuses.includes("error") ? rows(20) : [],
    );
    mockCountByStatus.mockResolvedValue({ ...ZERO_COUNTS, error: 20 });
    render(<BackupFailed />);
    expect(await screen.findByTestId("failed-pager-range")).toHaveTextContent("1-6 of 20");
    expect(screen.getByText("IMG_0.HEIC")).toBeTruthy();
    expect(screen.queryByText("IMG_6.HEIC")).toBeNull();

    fireEvent.press(screen.getByTestId("failed-pager-next"));
    expect(screen.getByTestId("failed-pager-range")).toHaveTextContent("7-12 of 20");
    expect(screen.getByText("IMG_6.HEIC")).toBeTruthy();
    expect(screen.queryByText("IMG_0.HEIC")).toBeNull();
  });

  it("admits when the ledger holds more than the 200 rows it loaded", async () => {
    // listByStatus stops at 200. Presenting that as the whole story is how
    // "Retry all 200" went on to retry 1,340 items.
    mockListByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
      statuses.includes("error") ? rows(200) : [],
    );
    mockCountByStatus.mockResolvedValue({ ...ZERO_COUNTS, error: 1340 });
    render(<BackupFailed />);
    expect(await screen.findByTestId("failed-truncated")).toHaveTextContent(
      /Showing the 200 most recent of 1340/,
    );
    expect(screen.getByTestId("retry-all")).toHaveTextContent("Retry all 1340");
  });

  it("says nothing about truncation when it has every row", async () => {
    mockListByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
      statuses.includes("error") ? rows(3) : [],
    );
    mockCountByStatus.mockResolvedValue({ ...ZERO_COUNTS, error: 3 });
    render(<BackupFailed />);
    await screen.findByText("IMG_0.HEIC");
    expect(screen.queryByTestId("failed-truncated")).toBeNull();
    expect(screen.queryByTestId("failed-pager")).toBeNull();
    expect(screen.getByTestId("retry-all")).toHaveTextContent("Retry all 3");
  });

  it("offers the size limit rather than a retry for size-capped items", async () => {
    mockListByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
      statuses.includes("skipped_large")
        ? [row({ local_id: "big", filename: "VID.mp4", status: "skipped_large", size: 3_221_225_472, last_error: null })]
        : [],
    );
    render(<BackupFailed />);
    expect(await screen.findByText("VID.mp4")).toBeTruthy();
    // Retrying would just re-skip it on the very next scan.
    expect(screen.queryByTestId("retry-all")).toBeNull();
    expect(screen.getByTestId("raise-limit")).toBeTruthy();
  });

  it("says so when nothing has failed", async () => {
    render(<BackupFailed />);
    expect(await screen.findByTestId("no-failures")).toBeTruthy();
  });

  it("shows nothing to retry without an active workspace", async () => {
    useWorkspaceStore.setState({ activeId: null } as never);
    render(<BackupFailed />);
    await waitFor(() => expect(mockListByStatus).not.toHaveBeenCalled());
  });
});
