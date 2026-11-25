const mockRows: any[] = [];
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => {}),
    runAsync: jest.fn(async (sql: string, ...params: any[]) => {
      const p = params.flat();
      if (sql.includes("DELETE")) {
        if (sql.includes("NOT IN")) {
          const keep = [...mockRows].sort((a, b) => b.at - a.at).slice(0, 100);
          mockRows.length = 0;
          mockRows.push(...keep);
        } else {
          mockRows.length = 0;
        }
      } else if (sql.includes("INSERT")) {
        mockRows.push({
          id: p[0],
          workspace_name: p[1],
          uploaded: p[2],
          deduped: p[3],
          skipped_large: p[4],
          failed: p[5],
          at: p[6],
        });
      }
      return { changes: 1 };
    }),
    getAllAsync: jest.fn(async (_sql: string, limit: number) =>
      [...mockRows].sort((a, b) => b.at - a.at).slice(0, limit),
    ),
  })),
}));

import { openHistory, recordBackupRun, getBackupHistory } from "./history";

beforeEach(() => {
  mockRows.length = 0;
});

describe("history", () => {
  it("openHistory is idempotent (no throw on repeated calls)", async () => {
    await openHistory();
    await openHistory();
  });

  it("recordBackupRun inserts a row with a unique id", async () => {
    await recordBackupRun({ workspace_name: "W1", uploaded: 3, deduped: 1, skipped_large: 0, failed: 0, at: 100 });
    const rows = await getBackupHistory();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspace_name: "W1", uploaded: 3, deduped: 1, skipped_large: 0, failed: 0, at: 100 });
    expect(rows[0].id).toBeTruthy();
  });

  it("getBackupHistory returns rows newest-first", async () => {
    await recordBackupRun({ workspace_name: "W1", uploaded: 1, deduped: 0, skipped_large: 0, failed: 0, at: 100 });
    await recordBackupRun({ workspace_name: "W1", uploaded: 2, deduped: 0, skipped_large: 0, failed: 0, at: 300 });
    await recordBackupRun({ workspace_name: "W1", uploaded: 3, deduped: 0, skipped_large: 0, failed: 0, at: 200 });
    const rows = await getBackupHistory();
    expect(rows.map((r) => r.at)).toEqual([300, 200, 100]);
  });

  it("assigns distinct ids even for runs recorded in the same second (monotonic seq, not Math.random)", async () => {
    await recordBackupRun({ workspace_name: "W1", uploaded: 1, deduped: 0, skipped_large: 0, failed: 0, at: 500 });
    await recordBackupRun({ workspace_name: "W1", uploaded: 1, deduped: 0, skipped_large: 0, failed: 0, at: 500 });
    const rows = await getBackupHistory();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await recordBackupRun({ workspace_name: "W1", uploaded: 1, deduped: 0, skipped_large: 0, failed: 0, at: i });
    }
    const rows = await getBackupHistory(2);
    expect(rows).toHaveLength(2);
  });
});

describe("clearHistory", () => {
  it("wipes all recorded runs (account purge on sign-out)", async () => {
    await recordBackupRun({ workspace_name: "W1", uploaded: 1, deduped: 0, skipped_large: 0, failed: 0, at: 1 });
    const { clearHistory } = require("./history");
    await clearHistory();
    expect(await getBackupHistory()).toHaveLength(0);
  });
});

describe("history pruning", () => {
  it("keeps only the newest 100 runs", async () => {
    for (let i = 0; i < 105; i++) {
      await recordBackupRun({ workspace_name: "W1", uploaded: 1, deduped: 0, skipped_large: 0, failed: 0, at: 1000 + i });
    }
    const rows = await getBackupHistory(500);
    expect(rows).toHaveLength(100);
    expect(rows[0].at).toBe(1104); // newest kept
  });
});
