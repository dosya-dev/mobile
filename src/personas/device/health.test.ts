// The background health log (./health.ts): the last 50 windows in the
// Personas cache DB, one Sentry breadcrumb per window, one event per
// unexpected error, and nothing that names a photo, a file or a face.
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));

import * as Sentry from "@sentry/react-native";
import { createHealthLog, type HealthDb, type WindowRecord } from "./health";

/** Enough of expo-sqlite for the log's statements. */
function fakeDb() {
  let rows: (WindowRecord & { id: number })[] = [];
  let next = 1;
  const db: HealthDb = {
    execAsync: async () => {},
    runAsync: (async (sql: string, ...args: unknown[]) => {
      if (sql.startsWith("INSERT INTO bg_windows")) {
        const [at, kind, ms, photos, end, platform, mode] = args as [number, WindowRecord["kind"], number, number, WindowRecord["end"], WindowRecord["platform"], WindowRecord["mode"]];
        rows.push({ id: next++, at, kind, ms, photos, end, platform, mode });
      } else if (sql.startsWith("DELETE FROM bg_windows")) {
        const keep = new Set([...rows].sort((a, b) => b.id - a.id).slice(0, Number(args[0])).map((r) => r.id));
        rows = rows.filter((r) => keep.has(r.id));
      } else throw new Error(`unexpected: ${sql}`);
      return { lastInsertRowId: next - 1, changes: 1 };
    }) as HealthDb["runAsync"],
    getAllAsync: (async (sql: string, ...args: unknown[]) => {
      if (!sql.startsWith("SELECT")) throw new Error(`unexpected: ${sql}`);
      return [...rows].sort((a, b) => b.id - a.id).slice(0, Number(args[0])).map(({ id: _id, ...r }) => r);
    }) as HealthDb["getAllAsync"],
  };
  return { db, rows: () => rows };
}

const row = (at: number, over: Partial<WindowRecord> = {}): WindowRecord => ({ at, kind: "processing", ms: 1000, photos: 10, end: "done", platform: "ios", mode: "charging", ...over });

beforeEach(() => jest.clearAllMocks());

it("keeps the last 50", async () => {
  const f = fakeDb();
  const log = createHealthLog(async () => f.db);
  for (let i = 1; i <= 55; i++) await log.recordWindow(row(i));
  const recent = await log.recentWindows();
  expect(recent).toHaveLength(50);
  expect(recent[0].at).toBe(55);
  expect(recent[49].at).toBe(6);
  expect(f.rows()).toHaveLength(50);
});

it("summary is the newest background window", async () => {
  const f = fakeDb();
  const log = createHealthLog(async () => f.db);
  expect(await log.lastBackgroundSummary()).toBeNull();
  await log.recordWindow(row(100, { photos: 312 }));
  await log.recordWindow(row(200, { photos: 40, kind: "worker", platform: "android" }));
  expect(await log.lastBackgroundSummary()).toEqual({ at: 200, photos: 40 });
  // A later window that read nothing does not hide it.
  await log.recordWindow(row(300, { photos: 0, end: "busy" }));
  expect(await log.lastBackgroundSummary()).toEqual({ at: 200, photos: 40 });
});

it("no summary while no window has read a photo", async () => {
  const f = fakeDb();
  const log = createHealthLog(async () => f.db);
  await log.recordWindow(row(100, { photos: 0, end: "gate" }));
  expect(await log.lastBackgroundSummary()).toBeNull();
});

it("error windows are recorded and reported once", async () => {
  const f = fakeDb();
  const log = createHealthLog(async () => f.db);
  const err = new Error("could not read IMG_0042.jpg (file f_123)");
  await log.recordWindow(row(1, { end: "error", photos: 0 }), err);
  expect((await log.recentWindows())[0]).toEqual(row(1, { end: "error", photos: 0 }));
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  const [sent, ctx] = (Sentry.captureException as jest.Mock).mock.calls[0];
  // The event says it failed, not what it was reading.
  expect(JSON.stringify({ m: (sent as Error).message, s: (sent as Error).stack, ctx })).not.toMatch(/IMG_0042|f_123/);
  // A window that ended normally sends no event.
  await log.recordWindow(row(2));
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});

it("breadcrumb carries no ids", async () => {
  const f = fakeDb();
  const log = createHealthLog(async () => f.db);
  await log.recordWindow(row(5, { kind: "continued", photos: 7, end: "deadline" }));
  expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  const crumb = (Sentry.addBreadcrumb as jest.Mock).mock.calls[0][0];
  expect(crumb.category).toBe("personas.bg");
  expect(Object.keys(crumb.data).sort()).toEqual(["at", "end", "kind", "mode", "ms", "photos", "platform"]);
  expect(crumb.data).toEqual(row(5, { kind: "continued", photos: 7, end: "deadline" }));
});

it("a database that cannot open still leaves the breadcrumb and never throws", async () => {
  const log = createHealthLog(async () => { throw new Error("disk"); });
  await expect(log.recordWindow(row(1))).resolves.toBeUndefined();
  expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  await expect(log.recentWindows()).resolves.toEqual([]);
});
