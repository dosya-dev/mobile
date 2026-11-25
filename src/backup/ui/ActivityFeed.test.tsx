import { fireEvent, render, screen } from "@testing-library/react-native";
import { ActivityFeed, HISTORY_PAGE_SIZE } from "./ActivityFeed";
import type { UploadItem } from "@/upload/types";
import type { BackupRunRecord } from "@/backup/history";

const item = (over: Partial<UploadItem>): UploadItem => ({
  id: "bk_a_1",
  name: "photo.jpg",
  uri: "x",
  size: 10,
  mime: "image/jpeg",
  folderId: null,
  workspaceId: "w1",
  status: "queued",
  progress: 0,
  ...over,
});

const HISTORY: BackupRunRecord[] = [
  { id: "run_1", workspace_name: "Personal", uploaded: 3, deduped: 1, skipped_large: 0, failed: 0, at: 1710000500 },
  { id: "run_2", workspace_name: null, uploaded: 0, deduped: 0, skipped_large: 0, failed: 2, at: 1709990000 },
];

/** `n` runs, newest first, each one identifiable by its index. */
const longHistory = (n: number): BackupRunRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `run_${i}`,
    workspace_name: `run ${i}`,
    uploaded: 1,
    deduped: 0,
    skipped_large: 0,
    failed: 0,
    at: 1710000000 - i * 3600,
  }));

describe("ActivityFeed", () => {
  it("pages six runs at a time", () => {
    expect(HISTORY_PAGE_SIZE).toBe(6);
  });

  it("shows a scanning row while the library scan runs with no uploads yet", () => {
    render(<ActivityFeed phase="scanning" items={[]} history={[]} />);
    expect(screen.getByTestId("backup-active")).toHaveTextContent(/Scanning/);
  });

  it("hides the scanning row once uploads are in flight and shows live rows", () => {
    render(
      <ActivityFeed
        phase="uploading"
        items={[item({ id: "bk_a_1", status: "uploading", progress: 0.45 }), item({ id: "bk_b_2", name: "b.jpg" })]}
        history={[]}
      />,
    );
    expect(screen.queryByTestId("backup-active")).toBeNull();
    expect(screen.getByText("photo.jpg")).toBeTruthy();
    expect(screen.getByText("45%")).toBeTruthy();
    expect(screen.getByTestId("queued-count")).toHaveTextContent("1 queued");
  });

  it("surfaces errored uploads with their reason", () => {
    render(
      <ActivityFeed
        phase="idle"
        items={[item({ status: "error", error: "Network request failed" })]}
        history={[]}
      />,
    );
    expect(screen.getByTestId("backup-error")).toHaveTextContent(/Network request failed/);
  });

  it("caps errored rows at 5 with a summary line for the rest (a fatal batch abort can flip hundreds to error)", () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      item({ id: `bk_err_${i}`, name: `file${i}.jpg`, status: "error", error: `boom ${i}` }),
    );
    render(<ActivityFeed phase="idle" items={items} history={[]} />);

    expect(screen.getAllByText(/boom \d/)).toHaveLength(5);
    expect(screen.getByText("2 more failed")).toBeTruthy();
  });

  it("renders history rows with sublines", () => {
    render(<ActivityFeed phase="idle" items={[]} history={HISTORY} />);
    expect(screen.getByTestId("backup-history")).toBeTruthy();
    expect(screen.getByText(/Personal/)).toBeTruthy();
    expect(screen.getByText(/3 backed up · 1 already backed up/)).toBeTruthy();
    expect(screen.getByText(/2 failed/)).toBeTruthy();
  });

  it("shows no pager while the history fits on one page", () => {
    render(<ActivityFeed phase="idle" items={[]} history={HISTORY} />);
    expect(screen.queryByTestId("backup-history-pager")).toBeNull();
  });

  it("pages a long history instead of rendering all of it", () => {
    // A phone that has been backing up for months keeps a hundred runs. All of
    // them at once buried the rest of the Backup screen under identical rows.
    const many = longHistory(20);
    render(<ActivityFeed phase="idle" items={[]} history={many} />);
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("1-6 of 20");
    expect(screen.getByText(/run 0/)).toBeTruthy();
    expect(screen.queryByText(/run 6/)).toBeNull();

    fireEvent.press(screen.getByTestId("backup-history-pager-next"));
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("7-12 of 20");
    expect(screen.queryByText(/run 0/)).toBeNull();
    expect(screen.getByText(/run 6/)).toBeTruthy();

    fireEvent.press(screen.getByTestId("backup-history-pager-prev"));
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("1-6 of 20");
  });

  it("stops at both ends, and the last page holds only the remainder", () => {
    render(<ActivityFeed phase="idle" items={[]} history={longHistory(20)} />);
    expect(screen.getByTestId("backup-history-pager-prev")).toBeDisabled();
    for (let i = 0; i < 3; i++) fireEvent.press(screen.getByTestId("backup-history-pager-next"));
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("19-20 of 20");
    expect(screen.getByTestId("backup-history-pager-next")).toBeDisabled();
    // Pressing a disabled control must not walk off the end into an empty page.
    fireEvent.press(screen.getByTestId("backup-history-pager-next"));
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("19-20 of 20");
    expect(screen.getByText(/run 18/)).toBeTruthy();
  });

  it("returns to the newest page when a finished run prepends a row", () => {
    // Every row below the new one shifts down by one, so the page the user was
    // reading no longer holds what it held a moment ago.
    const { rerender } = render(<ActivityFeed phase="idle" items={[]} history={longHistory(20)} />);
    fireEvent.press(screen.getByTestId("backup-history-pager-next"));
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("7-12 of 20");
    rerender(<ActivityFeed phase="idle" items={[]} history={longHistory(21)} />);
    expect(screen.getByTestId("backup-history-pager-range")).toHaveTextContent("1-6 of 21");
  });

  it("shows the empty state when there is nothing at all", () => {
    render(<ActivityFeed phase="idle" items={[]} history={[]} />);
    expect(screen.getByText("No backups yet.")).toBeTruthy();
  });
});
