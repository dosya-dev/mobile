// Hand-rolled expo-sqlite fake, same convention as src/backup/ledger.test.ts:
// SQL-string-sniffing over an in-memory Map, not a real SQLite engine.
let mockCurrent: any = null;
const mockRecent = new Map<string, any>();

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => {}),
    runAsync: jest.fn(async (sql: string, ...params: any[]) => {
      const p = params.flat();
      if (sql.includes("INSERT OR REPLACE INTO playback_current")) {
        const [workspace_id, folder_id, file_id, title, source_name, position_seconds, duration_seconds, updated_at] = p;
        mockCurrent = { workspace_id, folder_id, file_id, title, source_name, position_seconds, duration_seconds, updated_at };
      } else if (sql.includes("UPDATE playback_current")) {
        const [position_seconds, updated_at, file_id] = p;
        if (mockCurrent && mockCurrent.file_id === file_id) Object.assign(mockCurrent, { position_seconds, updated_at });
      } else if (sql.includes("INSERT OR REPLACE INTO playback_recent")) {
        const [file_id, workspace_id, folder_id, title, source_name, updated_at] = p;
        mockRecent.set(file_id, { file_id, workspace_id, folder_id, title, source_name, updated_at });
      } else if (sql.includes("DELETE FROM playback_recent")) {
        if (p.length === 0) {
          // clearIncarHistory: unparameterised, wipes the whole table.
          mockRecent.clear();
        } else {
          const limit = p[0];
          const sorted = [...mockRecent.values()].sort((a, b) => b.updated_at - a.updated_at);
          const keep = new Set(sorted.slice(0, limit).map((r) => r.file_id));
          for (const key of [...mockRecent.keys()]) if (!keep.has(key)) mockRecent.delete(key);
        }
      } else if (sql.includes("DELETE FROM playback_current")) {
        mockCurrent = null;
      }
      return { changes: 1 };
    }),
    getFirstAsync: jest.fn(async () => mockCurrent),
    getAllAsync: jest.fn(async (_sql: string, workspaceId: string, limit: number) =>
      [...mockRecent.values()]
        .filter((r) => r.workspace_id === workspaceId)
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit),
    ),
  })),
}));

import {
  getCurrentPlayback,
  setCurrentPlayback,
  updatePlaybackPosition,
  pushRecent,
  getRecent,
  clearIncarHistory,
} from "./recents";

describe("recents", () => {
  beforeEach(() => {
    mockCurrent = null;
    mockRecent.clear();
  });

  it("returns null when nothing has ever played", async () => {
    expect(await getCurrentPlayback()).toBeNull();
  });

  it("round-trips current playback", async () => {
    await setCurrentPlayback(
      { workspaceId: "ws1", folderId: "f1", fileId: "file1", title: "Track 1", sourceName: "Podcasts", positionSeconds: 0, durationSeconds: 120 },
      1000,
    );
    const got = await getCurrentPlayback();
    expect(got).toEqual({
      workspaceId: "ws1", folderId: "f1", fileId: "file1", title: "Track 1",
      sourceName: "Podcasts", positionSeconds: 0, durationSeconds: 120, updatedAt: 1000,
    });
  });

  it("checkpoints position for the current track only", async () => {
    await setCurrentPlayback(
      { workspaceId: "ws1", folderId: "f1", fileId: "file1", title: "Track 1", sourceName: "Podcasts", positionSeconds: 0, durationSeconds: 120 },
      1000,
    );
    await updatePlaybackPosition("file1", 45, 1010);
    expect((await getCurrentPlayback())?.positionSeconds).toBe(45);

    // A checkpoint for a track that isn't current (a race with a track change) is dropped.
    await updatePlaybackPosition("someOtherFile", 99, 1020);
    expect((await getCurrentPlayback())?.positionSeconds).toBe(45);
  });

  it("caps recently-played at the given limit, newest first", async () => {
    for (let i = 0; i < 25; i++) {
      await pushRecent(
        { fileId: `file${i}`, workspaceId: "ws1", folderId: "f1", title: `Track ${i}`, sourceName: "Podcasts" },
        1000 + i,
      );
    }
    const got = await getRecent("ws1", 20);
    expect(got).toHaveLength(20);
    expect(got[0].fileId).toBe("file24");
    expect(got.map((r) => r.fileId)).not.toContain("file0");
  });

  it("replaying a file already in recents bumps it instead of duplicating", async () => {
    await pushRecent({ fileId: "file1", workspaceId: "ws1", folderId: "f1", title: "Track 1", sourceName: "Podcasts" }, 1000);
    await pushRecent({ fileId: "file2", workspaceId: "ws1", folderId: "f1", title: "Track 2", sourceName: "Podcasts" }, 1001);
    await pushRecent({ fileId: "file1", workspaceId: "ws1", folderId: "f1", title: "Track 1", sourceName: "Podcasts" }, 1002);
    const got = await getRecent("ws1", 20);
    expect(got).toHaveLength(2);
    expect(got[0].fileId).toBe("file1");
  });

  it("only returns the asked-for workspace's recents", async () => {
    // playback_recent is one device-wide table, so a member of several
    // workspaces would otherwise see every workspace's tracks mixed together.
    await pushRecent({ fileId: "file1", workspaceId: "ws1", folderId: null, title: "Mine", sourceName: "Personal" }, 1000);
    await pushRecent({ fileId: "file2", workspaceId: "ws2", folderId: null, title: "Team's", sourceName: "Acme" }, 1001);
    const got = await getRecent("ws1");
    expect(got.map((r) => r.fileId)).toEqual(["file1"]);
  });

  it("clearIncarHistory wipes both tables so the next account starts clean", async () => {
    await setCurrentPlayback(
      { workspaceId: "ws1", folderId: "f1", fileId: "file1", title: "Track 1", sourceName: "Podcasts", positionSeconds: 30, durationSeconds: 120 },
      1000,
    );
    await pushRecent({ fileId: "file1", workspaceId: "ws1", folderId: "f1", title: "Track 1", sourceName: "Podcasts" }, 1000);

    await clearIncarHistory();

    expect(await getCurrentPlayback()).toBeNull();
    expect(await getRecent("ws1")).toEqual([]);
  });
});
