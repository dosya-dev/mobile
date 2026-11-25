const mockRows = new Map<string, any>();
// The table's columns, so PRAGMA table_info answers honestly and the DDL
// statements below have real consequences. Without this the fake accepted a
// duplicate ALTER, which is exactly the failure openLedger has to avoid.
const mockSchema = {
  cols: ["workspace_id", "local_id", "filename", "size", "created_at", "fingerprint", "status", "remote_file_id", "attempts", "last_error", "mp_session", "pair_checked", "session_id", "job_id", "staged_path"] as string[],
  failAlter: false,
  /** Every DDL statement the ledger executed, so the specs can assert on it
   * without reaching into the shared jest.fn's call list. */
  log: [] as string[],
};
// `mock`-prefixed: babel-plugin-jest-hoist only lets a jest.mock() factory
// reference out-of-scope bindings under that convention (see pickers.test.ts).
const mockFullCols = [...mockSchema.cols];
// This fake honours the WHERE clauses of the statements it recognises rather
// than returning every row for any SELECT. An over-permissive fake here would
// happily pass a query that forgot its workspace or status filter, which is
// exactly the class of bug these tests exist to catch.
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async (sql: string) => {
      mockSchema.log.push(sql);
      if (sql.includes("DROP TABLE")) {
        mockSchema.cols = [];
        mockRows.clear();
        return;
      }
      if (sql.includes("CREATE TABLE")) {
        // IF NOT EXISTS: a table that is already there is left alone.
        if (mockSchema.cols.length === 0) mockSchema.cols = [...mockFullCols];
        return;
      }
      if (sql.includes("ALTER TABLE")) {
        if (mockSchema.failAlter) throw new Error("database is locked");
        const m = /ADD COLUMN (\w+)/.exec(sql);
        const col = m?.[1] ?? "";
        // SQLite rejects a second ADD COLUMN for the same name.
        if (mockSchema.cols.includes(col)) throw new Error(`duplicate column name: ${col}`);
        mockSchema.cols.push(col);
      }
    }),
    runAsync: jest.fn(async (sql: string, ...params: any[]) => {
      const p = params.flat();
      if (sql.includes("DELETE") && sql.includes("status = 'pending'")) {
        // deletePending: (workspace_id) - scoped, unlike clearLedger.
        let changes = 0;
        for (const [k, r] of [...mockRows.entries()]) {
          if (r.workspace_id !== p[0] || r.status !== "pending") continue;
          mockRows.delete(k);
          changes += 1;
        }
        return { changes };
      } else if (sql.includes("DELETE")) {
        mockRows.clear();
      } else if (sql.includes("INSERT") && sql.includes(", 0, ?)")) {
        // seedAssets: multi-row VALUES, one group of 4 params per row
        // (workspace_id, local_id, filename, created_at); size is the literal
        // 0 baked into the SQL, not a bound param.
        for (let i = 0; i < p.length; i += 4) {
          const [ws, localId, filename, createdAt] = p.slice(i, i + 4);
          const k = `${ws}:${localId}`;
          if (!mockRows.has(k)) {
            mockRows.set(k, { workspace_id: ws, local_id: localId, filename, size: 0, created_at: createdAt, fingerprint: null, status: "pending", remote_file_id: null, attempts: 0, last_error: null, mp_session: null, session_id: null, job_id: null, staged_path: null });
          }
        }
      } else if (sql.includes("INSERT")) {
        // (workspace_id, local_id, filename, size, created_at)
        const k = `${p[0]}:${p[1]}`;
        if (!mockRows.has(k)) mockRows.set(k, { workspace_id: p[0], local_id: p[1], filename: p[2], size: p[3], created_at: p[4], fingerprint: null, status: "pending", remote_file_id: null, attempts: 0, last_error: null, mp_session: null, session_id: null, job_id: null, staged_path: null });
      } else if (sql.includes("session_id = NULL")) {
        // requeueToPending: (lastError, workspace_id, local_id); attempts move
        // only when the statement says so.
        const r = mockRows.get(`${p[p.length - 2]}:${p[p.length - 1]}`);
        if (r) Object.assign(r, { status: "pending", session_id: null, job_id: null, staged_path: null, last_error: p[0], attempts: r.attempts + (sql.includes("attempts = attempts + 1") ? 1 : 0) });
      } else if (sql.includes("SET status = 'error'") && sql.includes("attempts >= ?")) {
        // retireExhausted: (lastErrorDefault, workspace_id, maxAttempts)
        let changes = 0;
        for (const r of mockRows.values()) {
          if (r.workspace_id !== p[1] || r.status !== "pending" || r.attempts < p[2]) continue;
          Object.assign(r, { status: "error", last_error: r.last_error ?? p[0] });
          changes += 1;
        }
        return { changes };
      } else if (sql.includes("SET status = 'pending'")) {
        // resetForRetry: (workspace_id, ...optional local_ids)
        const [ws, ...ids] = p;
        let changes = 0;
        for (const r of mockRows.values()) {
          if (r.workspace_id !== ws || r.status !== "error") continue;
          if (ids.length > 0 && !ids.includes(r.local_id)) continue;
          Object.assign(r, { status: "pending", attempts: 0, last_error: null });
          changes += 1;
        }
        return { changes };
      } else if (sql.includes("SET attempts = attempts + 1")) {
        // bumpAttempts: (lastError, workspace_id, local_id) - status untouched.
        const r = mockRows.get(`${p[p.length - 2]}:${p[p.length - 1]}`);
        if (r) Object.assign(r, { attempts: r.attempts + 1, last_error: p[0] });
      } else if (sql.includes("status = 'queued'")) {
        // markQueued: (sessionId, jobId, stagedPath, fingerprint, size, workspace_id, local_id)
        const r = mockRows.get(`${p[p.length - 2]}:${p[p.length - 1]}`);
        if (r) Object.assign(r, { status: "queued", session_id: p[0], job_id: p[1], staged_path: p[2], fingerprint: p[3] ?? r.fingerprint, size: p[4] });
      } else if (sql.includes("UPDATE")) {
        // ... WHERE workspace_id = ? AND local_id = ?  → last two params
        const r = mockRows.get(`${p[p.length - 2]}:${p[p.length - 1]}`);
        if (r) {
          if (sql.includes("mp_session")) r.mp_session = p[0];
          else if (sql.includes("pair_checked")) r.pair_checked = 1;
          else Object.assign(r, {
            // setStatus: (status, remoteFileId, fingerprint, lastError,
            // incAttempts, size, workspace_id, local_id) - the COALESCEd
            // columns keep their stored value when the caller passes null.
            status: p[0],
            remote_file_id: p[1] ?? r.remote_file_id,
            fingerprint: p[2] ?? r.fingerprint,
            last_error: p[3] ?? r.last_error,
            attempts: r.attempts + (p[4] ?? 0),
            size: p[5] ?? r.size,
          });
        }
      }
      return { changes: 1 };
    }),
    getFirstAsync: jest.fn(async (_sql: string, ws: string, id: string) => mockRows.get(`${ws}:${id}`) ?? null),
    getAllAsync: jest.fn(async (sql: string, ...params: any[]) => {
      if (sql.includes("PRAGMA table_info")) return mockSchema.cols.map((name) => ({ name }));
      const p = params.flat();
      let rows = Array.from(mockRows.values());
      if (sql.includes("SELECT DISTINCT workspace_id")) {
        // distinctWorkspaceIds: no parameters, no workspace filter.
        return [...new Set(rows.map((r) => r.workspace_id))].map((workspace_id) => ({ workspace_id }));
      }
      if (sql.includes("job_id IN")) {
        // getByJobIds: (...jobIds) - deliberately not scoped to a workspace.
        return rows.filter((r) => r.job_id != null && p.includes(r.job_id));
      }
      if (!sql.includes("WHERE workspace_id = ?")) return rows;
      rows = rows.filter((r) => r.workspace_id === p[0]);

      if (sql.includes("attempts < ?")) {
        // listPlannable: (workspace_id, maxAttempts, limit)
        const [, maxAttempts, limit] = p;
        return rows
          .filter((r) => r.status === "pending" && r.attempts < maxAttempts)
          // ORDER BY attempts ASC, created_at ASC, local_id ASC.
          .sort((a, b) => a.attempts - b.attempts || a.created_at - b.created_at || (a.local_id < b.local_id ? -1 : 1))
          .slice(0, limit);
      }
      if (sql.includes("status IN")) {
        // listByStatus: (workspace_id, ...statuses, limit)
        const limit = p[p.length - 1];
        const statuses = p.slice(1, p.length - 1);
        return rows
          .filter((r) => statuses.includes(r.status))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit);
      }
      if (sql.includes("pair_checked = 0")) {
        // listUploadedUnpaired: (workspace_id, limit)
        const limit = p[p.length - 1];
        return rows
          .filter((r) => r.status === "uploaded" && !(r.pair_checked ?? 0) && !r.local_id.endsWith("#video"))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit);
      }
      if (sql.includes("status = 'uploaded'")) {
        // listReclaimable
        return rows
          .filter((r) => r.status === "uploaded" && r.remote_file_id != null)
          .sort((a, b) => b.size - a.size);
      }
      if (sql.includes("local_id IN")) {
        // getAssetsBulk: (workspace_id, ...ids)
        const ids = p.slice(1);
        return rows.filter((r) => ids.includes(r.local_id));
      }
      if (sql.includes("GROUP BY status, pair")) {
        // countByStatus: (status, local_id LIKE '%#video' AS pair, COUNT(*))
        const counts = new Map<string, { status: string; pair: number; n: number }>();
        for (const r of rows) {
          const pair = r.local_id.endsWith("#video") ? 1 : 0;
          const k = `${r.status}:${pair}`;
          const cur = counts.get(k) ?? { status: r.status, pair, n: 0 };
          cur.n += 1;
          counts.set(k, cur);
        }
        return [...counts.values()];
      }
      return rows;
    }),
  })),
}));

import * as SQLite from "expo-sqlite";
import { openLedger, upsertAsset, getAsset, setStatus, setMpSession, listByStatus, resetForRetry, markPairChecked, countByStatus, seedAssets, listPlannable, markQueued, getByJobIds, requeueToPending, bumpAttempts, distinctWorkspaceIds, deletePending, listUploadedUnpaired, retireExhausted } from "./ledger";

beforeEach(() => {
  mockRows.clear();
  mockSchema.cols = [...mockFullCols];
  mockSchema.failAlter = false;
  mockSchema.log.length = 0;
});

const ddl = () => mockSchema.log;

describe("openLedger - schema migration paths", () => {
  it("adds pair_checked and the queued-job columns to an existing table that predates them", async () => {
    mockSchema.cols = ["workspace_id", "local_id", "filename", "size", "created_at", "status"];
    await expect(openLedger()).resolves.toBeUndefined();
    const alters = ddl().filter((s) => s.includes("ALTER TABLE"));
    expect(alters).toHaveLength(4);
    expect(alters.join("\n")).toMatch(/ADD COLUMN pair_checked/);
    expect(alters.join("\n")).toMatch(/ADD COLUMN session_id/);
    expect(alters.join("\n")).toMatch(/ADD COLUMN job_id/);
    expect(alters.join("\n")).toMatch(/ADD COLUMN staged_path/);
    expect(mockSchema.cols).toEqual(expect.arrayContaining(["pair_checked", "session_id", "job_id", "staged_path"]));
  });

  it("does NOT re-add it on a fresh install - CREATE TABLE already carries the column", async () => {
    mockSchema.cols = [];
    await expect(openLedger()).resolves.toBeUndefined();
    expect(ddl().filter((s) => s.includes("ALTER TABLE"))).toEqual([]);
  });

  /**
   * The one that broke every backup: on a pre-workspace install the table is
   * DROPPED and recreated from SCHEMA (which already has pair_checked), but the
   * ALTER guard was built from the columns read BEFORE the drop - so it fired
   * anyway, SQLite raised "duplicate column name", openLedger rejected and
   * every runBackup threw.
   */
  it("survives the legacy pre-workspace drop path, which recreates the table WITH the column", async () => {
    mockSchema.cols = ["local_id", "filename", "size", "created_at", "status"]; // no workspace_id
    await expect(openLedger()).resolves.toBeUndefined();
    expect(ddl().some((s) => s.includes("DROP TABLE"))).toBe(true);
    expect(ddl().filter((s) => s.includes("ALTER TABLE"))).toEqual([]);
    expect(mockSchema.cols).toContain("pair_checked");
  });

  it("never rejects when the ALTER itself fails - the ledger still opens", async () => {
    mockSchema.cols = ["workspace_id", "local_id", "status"];
    mockSchema.failAlter = true;
    await expect(openLedger()).resolves.toBeUndefined();
  });
});

describe("ledger - Live Photo pair bookkeeping", () => {

  it("listUploadedUnpaired finds backed-up stills nothing has probed, newest first", async () => {
    await openLedger();
    const seed = async (id: string, createdAt: number) => {
      await upsertAsset({ workspace_id: "w1", local_id: id, filename: `${id}.heic`, size: 1, created_at: createdAt });
      await setStatus("w1", id, "uploaded", { remoteFileId: `f_${id}` });
    };
    await seed("old", 1);
    await seed("new", 9);
    await seed("done", 5);
    await markPairChecked("w1", "done");
    await seed("new#video", 9); // a pair has no pair of its own
    await upsertAsset({ workspace_id: "w1", local_id: "waiting", filename: "w.heic", size: 1, created_at: 7 });
    await upsertAsset({ workspace_id: "w2", local_id: "theirs", filename: "t.heic", size: 1, created_at: 8 });
    await setStatus("w2", "theirs", "uploaded", { remoteFileId: "f" });

    expect((await listUploadedUnpaired("w1", 10)).map((r) => r.local_id)).toEqual(["new", "old"]);
    expect((await listUploadedUnpaired("w1", 1)).map((r) => r.local_id)).toEqual(["new"]);
  });

  it("markPairChecked flips the still's flag so the next scan does not probe it again", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "s1", filename: "IMG.HEIC", size: 100, created_at: 5 });
    expect((await getAsset("w1", "s1"))?.pair_checked ?? 0).toBe(0);
    await markPairChecked("w1", "s1");
    expect((await getAsset("w1", "s1"))?.pair_checked).toBe(1);
  });
});

describe("ledger", () => {
  it("upserts and reads an asset as pending", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "a1", filename: "IMG.jpg", size: 100, created_at: 5 });
    const r = await getAsset("w1", "a1");
    expect(r?.status).toBe("pending");
    expect(r?.filename).toBe("IMG.jpg");
  });

  it("scopes dedup by workspace - the same asset in two workspaces is independent", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "a1", filename: "IMG.jpg", size: 100, created_at: 5 });
    await setStatus("w1", "a1", "uploaded", { remoteFileId: "f1" });
    // Same local_id, different workspace → a separate, still-pending row.
    await upsertAsset({ workspace_id: "w2", local_id: "a1", filename: "IMG.jpg", size: 100, created_at: 5 });
    expect((await getAsset("w1", "a1"))?.status).toBe("uploaded");
    expect((await getAsset("w2", "a1"))?.status).toBe("pending");
  });

  it("upsert is idempotent (no reset)", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "a1", filename: "IMG.jpg", size: 100, created_at: 5 });
    await setStatus("w1", "a1", "uploaded", { remoteFileId: "f1", fingerprint: "fp1" });
    await upsertAsset({ workspace_id: "w1", local_id: "a1", filename: "IMG.jpg", size: 100, created_at: 5 });
    const r = await getAsset("w1", "a1");
    expect(r?.status).toBe("uploaded");
    expect(r?.remote_file_id).toBe("f1");
  });

  it("persists and clears a resumable multipart session", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "a2", filename: "v.mp4", size: 999, created_at: 5 });
    const sessionJson = JSON.stringify({ partSize: 1024 });
    await setMpSession("w1", "a2", sessionJson);
    expect((await getAsset("w1", "a2"))?.mp_session).toBe(sessionJson);
    await setMpSession("w1", "a2", null);
    expect((await getAsset("w1", "a2"))?.mp_session).toBeNull();
  });
});

describe("distinctWorkspaceIds / deletePending", () => {
  it("names every workspace with rows, including one the settings no longer list", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "wA", local_id: "a", filename: "a.jpg", size: 1, created_at: 1 });
    await upsertAsset({ workspace_id: "wA", local_id: "b", filename: "b.jpg", size: 1, created_at: 2 });
    await upsertAsset({ workspace_id: "wB", local_id: "c", filename: "c.jpg", size: 1, created_at: 3 });
    expect((await distinctWorkspaceIds()).sort()).toEqual(["wA", "wB"]);
  });

  it("deletePending drops only this workspace's not-yet-started rows", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "p", filename: "p.jpg", size: 1, created_at: 1 });
    await upsertAsset({ workspace_id: "w1", local_id: "q", filename: "q.jpg", size: 1, created_at: 2 });
    await upsertAsset({ workspace_id: "w2", local_id: "other", filename: "o.jpg", size: 1, created_at: 3 });
    await markQueued("w1", "q", { sessionId: "s", jobId: "j", stagedPath: "/s/q", fingerprint: null, size: 1 });

    await expect(deletePending("w1")).resolves.toBe(1);
    expect(await getAsset("w1", "p")).toBeNull();
    // A job is in flight for this one; dropping the row would strand it.
    expect((await getAsset("w1", "q"))?.status).toBe("queued");
    expect(await getAsset("w2", "other")).not.toBeNull();
  });
});

describe("clearLedger", () => {
  it("wipes every workspace's rows (account purge on sign-out)", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "p1", filename: "a.jpg", size: 1, created_at: 1 });
    await upsertAsset({ workspace_id: "w2", local_id: "p2", filename: "b.jpg", size: 1, created_at: 1 });
    const { clearLedger } = require("./ledger");
    await clearLedger();
    expect(await getAsset("w1", "p1")).toBeNull();
    expect(await getAsset("w2", "p2")).toBeNull();
  });
});

describe("listByStatus", () => {
  const seed = async (rows: { id: string; status?: string; created_at?: number; ws?: string }[]) => {
    await openLedger();
    for (const r of rows) {
      await upsertAsset({ workspace_id: r.ws ?? "w1", local_id: r.id, filename: `${r.id}.jpg`, size: 1, created_at: r.created_at ?? 0 });
      if (r.status) await setStatus(r.ws ?? "w1", r.id, r.status as never, { lastError: "boom" });
    }
  };

  it("lists failed rows newest first", async () => {
    await seed([
      { id: "a", status: "error", created_at: 100 },
      { id: "b", status: "uploaded", created_at: 200 },
      { id: "c", status: "error", created_at: 300 },
    ]);
    const rows = await listByStatus("w1", ["error"]);
    expect(rows.map((r) => r.local_id)).toEqual(["c", "a"]);
  });

  it("does not leak another workspace's failures", async () => {
    await seed([
      { id: "mine", status: "error", created_at: 1 },
      { id: "theirs", status: "error", created_at: 2, ws: "w2" },
    ]);
    expect((await listByStatus("w1", ["error"])).map((r) => r.local_id)).toEqual(["mine"]);
  });

  it("can list several statuses at once", async () => {
    await seed([
      { id: "a", status: "error", created_at: 1 },
      { id: "b", status: "skipped_large", created_at: 2 },
      { id: "c", status: "uploaded", created_at: 3 },
    ]);
    const rows = await listByStatus("w1", ["error", "skipped_large"]);
    expect(rows.map((r) => r.local_id).sort()).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty status list rather than everything", async () => {
    await seed([{ id: "a", status: "error" }]);
    expect(await listByStatus("w1", [])).toEqual([]);
  });
});

describe("resetForRetry", () => {
  const seedError = async (id: string, attempts: number) => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: id, filename: `${id}.jpg`, size: 1, created_at: 1 });
    for (let i = 0; i < attempts; i += 1) {
      await setStatus("w1", id, "error", { lastError: "boom", incAttempts: true });
    }
  };

  it("zeroes the attempt count so the scan's cap releases", async () => {
    await seedError("a", 5);
    expect((await getAsset("w1", "a"))?.attempts).toBe(5);
    await expect(resetForRetry("w1")).resolves.toBe(1);
    // Past MAX_BACKUP_ATTEMPTS the scan skips an asset forever, so zeroing
    // attempts is the part that actually makes a retry happen.
    expect(await getAsset("w1", "a")).toMatchObject({ status: "pending", attempts: 0, last_error: null });
  });

  it("leaves size-capped rows alone - only raising the cap releases those", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "big", filename: "big.mp4", size: 1, created_at: 1 });
    await setStatus("w1", "big", "skipped_large", {});
    await expect(resetForRetry("w1")).resolves.toBe(0);
    expect(await getAsset("w1", "big")).toMatchObject({ status: "skipped_large" });
  });

  it("can retry a single asset instead of all of them", async () => {
    await seedError("a", 5);
    await seedError("b", 5);
    await expect(resetForRetry("w1", ["a"])).resolves.toBe(1);
    expect((await getAsset("w1", "a"))?.status).toBe("pending");
    expect((await getAsset("w1", "b"))?.status).toBe("error");
  });

  it("never touches another workspace", async () => {
    await seedError("a", 5);
    await openLedger();
    await upsertAsset({ workspace_id: "w2", local_id: "other", filename: "o.jpg", size: 1, created_at: 1 });
    await setStatus("w2", "other", "error", { lastError: "boom", incAttempts: true });
    await resetForRetry("w1");
    expect((await getAsset("w2", "other"))?.status).toBe("error");
  });
});

describe("countByStatus", () => {
  const seed = async (id: string, status: "pending" | "uploaded" | "error" | "skipped_large") => {
    await upsertAsset({ workspace_id: "w1", local_id: id, filename: `${id}.jpg`, size: 10, created_at: 1 });
    if (status !== "pending") await setStatus("w1", id, status);
  };

  it("counts a Live Photo as one library item, not one per ledger row", async () => {
    await seed("a", "uploaded");
    await seed("a#video", "uploaded"); // livePhotoLedgerId("a")
    await seed("b", "pending");
    await seed("b#video", "pending");
    await seed("other-ws", "uploaded");
    (mockRows.get("w1:other-ws") as any).workspace_id = "w2";

    await expect(countByStatus("w1")).resolves.toEqual({ pending: 1, queued: 0, uploaded: 1, skipped_large: 0, error: 0 });
  });

  it("still surfaces a paired video that failed or was too large", async () => {
    await seed("a", "uploaded");
    await seed("a#video", "error");
    await seed("c", "uploaded");
    await seed("c#video", "skipped_large");

    await expect(countByStatus("w1")).resolves.toEqual({ pending: 0, queued: 0, uploaded: 2, skipped_large: 1, error: 1 });
  });

  it("answers zeros without a workspace", async () => {
    await expect(countByStatus(null)).resolves.toEqual({ pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 0 });
  });
});

describe("queued jobs", () => {
  it("seedAssets inserts rows it does not have and leaves existing ones alone", async () => {
    await upsertAsset({ workspace_id: "w1", local_id: "a", filename: "a.jpg", size: 5, created_at: 1 });
    await setStatus("w1", "a", "uploaded");
    await seedAssets("w1", [{ local_id: "a", filename: "a.jpg", created_at: 1 }, { local_id: "b", filename: "b.jpg", created_at: 2 }]);
    expect((await getAsset("w1", "a"))?.status).toBe("uploaded");
    expect((await getAsset("w1", "b"))).toMatchObject({ status: "pending", size: 0 });
  });

  // seedAssets writes size 0 (a scan cannot know byte counts), so a row that
  // never reaches `markQueued` - deduped, over the cap, refused - would keep
  // that 0 and everything that sums sizes would under-report it.
  it("setStatus backfills the staged size, and leaves it alone when not given one", async () => {
    await seedAssets("w1", [{ local_id: "a", filename: "a.jpg", created_at: 1 }]);
    expect((await getAsset("w1", "a"))?.size).toBe(0);
    await setStatus("w1", "a", "uploaded", { remoteFileId: "f1", size: 4242 });
    expect(await getAsset("w1", "a")).toMatchObject({ status: "uploaded", size: 4242 });
    await setStatus("w1", "a", "error", { lastError: "boom" });
    expect((await getAsset("w1", "a"))?.size).toBe(4242);
  });

  it("listPlannable returns pending items oldest first, skipping retired ones", async () => {
    await seedAssets("w1", [
      { local_id: "new", filename: "n.jpg", created_at: 3 }, { local_id: "old", filename: "o.jpg", created_at: 1 },
      { local_id: "dead", filename: "d.jpg", created_at: 2 },
    ]);
    for (let i = 0; i < 5; i++) await setStatus("w1", "dead", "error", { incAttempts: true });
    const rows = await listPlannable("w1", 10, 5);
    expect(rows.map((r) => r.local_id)).toEqual(["old", "new"]);
  });

  it("requeueToPending charges an attempt by default", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "a", filename: "a.jpg", size: 1, created_at: 1 });
    await requeueToPending("w1", "a", "object never registered");
    expect((await getAsset("w1", "a"))?.attempts).toBe(1);
  });

  it("stop does not charge", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "a", filename: "a.jpg", size: 1, created_at: 1 });
    await requeueToPending("w1", "a", "Stopped", { charge: false });
    const row = await getAsset("w1", "a");
    expect(row?.attempts).toBe(0);
    expect(row?.status).toBe("pending");
    expect(row?.last_error).toBe("Stopped");
  });

  it("exhausted rows retire into error so the Failed screen shows them", async () => {
    await openLedger();
    await upsertAsset({ workspace_id: "w1", local_id: "tired", filename: "t.jpg", size: 1, created_at: 1 });
    await upsertAsset({ workspace_id: "w1", local_id: "fresh", filename: "f.jpg", size: 1, created_at: 2 });
    for (let i = 0; i < 5; i++) await bumpAttempts("w1", "tired", "Could not read this item from the library");
    expect(await retireExhausted("w1", 5)).toBe(1);
    expect((await getAsset("w1", "tired"))?.status).toBe("error");
    expect((await getAsset("w1", "tired"))?.last_error).toBe("Could not read this item from the library");
    expect((await getAsset("w1", "fresh"))?.status).toBe("pending");
    // And Retry on the Failed screen releases it.
    expect(await resetForRetry("w1")).toBe(1);
    expect((await getAsset("w1", "tired"))?.attempts).toBe(0);
  });

  // A pair that failed its job goes back to `pending`, and excluding it here
  // meant it was never planned again - the motion half of that Live Photo was
  // silently lost. The transport routes such a row back to a `pairedVideo`
  // staging request rather than treating its id as a library asset.
  it("listPlannable includes a Live Photo's paired video row", async () => {
    await seedAssets("w1", [
      { local_id: "old", filename: "o.jpg", created_at: 1 },
      { local_id: "old#video", filename: "o.mov", created_at: 1 },
    ]);
    const rows = await listPlannable("w1", 10, 5);
    expect(rows.map((r) => r.local_id)).toEqual(["old", "old#video"]);
  });

  /**
   * A row that cannot be staged burns an attempt but stays pending, so without
   * `attempts ASC` it would sort to the head of the date order and take a slot
   * in every batch until the app was deleted - and once enough of them piled
   * up, a whole batch would be nothing but doomed rows and the planner's
   * `queued: 0` would end the run.
   */
  it("listPlannable puts the least-tried rows first, so a stuck one cannot hold a slot forever", async () => {
    await seedAssets("w1", [
      { local_id: "stuck", filename: "s.jpg", created_at: 1 },
      { local_id: "fresh", filename: "f.jpg", created_at: 9 },
      { local_id: "tried-once", filename: "t.jpg", created_at: 5 },
    ]);
    await bumpAttempts("w1", "stuck", "Could not read this item from the library");
    await bumpAttempts("w1", "stuck", "Could not read this item from the library");
    await bumpAttempts("w1", "tried-once", "Could not read this item from the library");

    expect((await listPlannable("w1", 10, 5)).map((r) => r.local_id)).toEqual(["fresh", "tried-once", "stuck"]);
  });

  it("bumpAttempts charges a try without taking the row out of the queue", async () => {
    await seedAssets("w1", [{ local_id: "a", filename: "a.jpg", created_at: 1 }]);
    await bumpAttempts("w1", "a", "Could not read this item from the library");
    expect(await getAsset("w1", "a")).toMatchObject({ status: "pending", attempts: 1, last_error: "Could not read this item from the library" });
    // Still plannable - unlike an `error` row, which listPlannable never sees.
    expect((await listPlannable("w1", 10, 5)).map((r) => r.local_id)).toEqual(["a"]);
    // And it retires at the cap like any other row.
    for (let i = 0; i < 4; i += 1) await bumpAttempts("w1", "a", "nope");
    expect(await listPlannable("w1", 10, 5)).toEqual([]);
  });

  it("markQueued records the job, getByJobIds finds it, requeueToPending clears it", async () => {
    await seedAssets("w1", [{ local_id: "a", filename: "a.jpg", created_at: 1 }]);
    await markQueued("w1", "a", { sessionId: "upl_1", jobId: "job_1", stagedPath: "/s/a.jpg", fingerprint: "fp", size: 99 });
    expect(await getAsset("w1", "a")).toMatchObject({ status: "queued", session_id: "upl_1", job_id: "job_1", staged_path: "/s/a.jpg", fingerprint: "fp", size: 99 });
    expect((await getByJobIds(["job_1"])).map((r) => r.local_id)).toEqual(["a"]);
    await requeueToPending("w1", "a", "HTTP 403");
    expect(await getAsset("w1", "a")).toMatchObject({ status: "pending", session_id: null, job_id: null, staged_path: null, attempts: 1, last_error: "HTTP 403" });
  });
});
