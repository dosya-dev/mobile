// Knowing background reading works (spec 11.3): every background window
// leaves one row in a ring buffer (the last 50) in the Personas cache DB, one
// Sentry breadcrumb, and, when it ended in an unexpected error, one Sentry
// event. Nothing here names a photo, a file or a face: the rows and the
// breadcrumb hold only the fields below, and the event carries the error's
// name, never its message.
import * as Sentry from "@sentry/react-native";
import type * as SQLite from "expo-sqlite";
import type { WindowEnd, WindowKind } from "./background";
import type { ReadMode } from "./settings";

export interface WindowRecord {
  at: number;
  kind: WindowKind;
  ms: number;
  photos: number;
  end: WindowEnd["reason"] | "error";
  platform: "ios" | "android";
  mode: ReadMode;
}

export type HealthDb = Pick<SQLite.SQLiteDatabase, "execAsync" | "runAsync" | "getAllAsync">;

const KEEP = 50;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS bg_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ms INTEGER NOT NULL,
  photos INTEGER NOT NULL,
  end_reason TEXT NOT NULL,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL
);
`;

export interface HealthLog {
  /** Never throws. Pass the error for a window that ended in an unexpected one. */
  recordWindow(r: WindowRecord, error?: unknown): Promise<void>;
  /** Newest first; empty when the log cannot be read. */
  recentWindows(): Promise<WindowRecord[]>;
  /** The newest window that read at least one photo; null when none did. */
  lastBackgroundSummary(): Promise<{ at: number; photos: number } | null>;
}

const fields = (r: WindowRecord): WindowRecord => ({ at: r.at, kind: r.kind, ms: r.ms, photos: r.photos, end: r.end, platform: r.platform, mode: r.mode });

// ./ports.ts imports the engine (and through it the 3 MB e2ee bundle); this
// module is on the app's boot path (index.js -> ./background.ts), so the
// cache DB is reached only when a row is written or read.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openAppCacheDb = (): Promise<HealthDb> => (require("./ports") as typeof import("./ports")).openCacheDb();

export function createHealthLog(open: () => Promise<HealthDb> = openAppCacheDb): HealthLog {
  let ready: Promise<HealthDb> | null = null;
  const db = () => {
    ready ??= open().then(async (d) => {
      await d.execAsync(SCHEMA);
      return d;
    });
    ready.catch(() => {
      ready = null;
    });
    return ready;
  };

  async function recentWindows(): Promise<WindowRecord[]> {
    try {
      return await (await db()).getAllAsync<WindowRecord>(
        'SELECT at, kind, ms, photos, end_reason AS "end", platform, mode FROM bg_windows ORDER BY id DESC LIMIT ?', KEEP,
      );
    } catch {
      return [];
    }
  }

  return {
    async recordWindow(r, error) {
      const data = fields(r);
      try {
        Sentry.addBreadcrumb({ category: "personas.bg", level: r.end === "error" ? "error" : "info", data: { ...data } });
        if (error !== undefined) {
          const name = error instanceof Error ? error.name : typeof error;
          const sent = new Error(`personas background window failed (${name})`);
          sent.name = "PersonasBackgroundError";
          Sentry.captureException(sent, { tags: { "personas.kind": r.kind, "personas.mode": r.mode } });
        }
      } catch {
        /* telemetry must never stop a window */
      }
      try {
        const d = await db();
        await d.runAsync(
          "INSERT INTO bg_windows (at, kind, ms, photos, end_reason, platform, mode) VALUES (?, ?, ?, ?, ?, ?, ?)",
          data.at, data.kind, data.ms, data.photos, data.end, data.platform, data.mode,
        );
        await d.runAsync("DELETE FROM bg_windows WHERE id NOT IN (SELECT id FROM bg_windows ORDER BY id DESC LIMIT ?)", KEEP);
      } catch {
        /* the breadcrumb still says it ran */
      }
    },
    recentWindows,
    /** The newest window that read something: a window that read nothing (busy, gate) does not hide the last one that did. */
    async lastBackgroundSummary() {
      const newest = (await recentWindows()).find((r) => r.photos > 0);
      return newest ? { at: newest.at, photos: newest.photos } : null;
    },
  };
}

const appLog = createHealthLog();

export const recordWindow: HealthLog["recordWindow"] = (r, error) => appLog.recordWindow(r, error);
export const recentWindows: HealthLog["recentWindows"] = () => appLog.recentWindows();
export const lastBackgroundSummary: HealthLog["lastBackgroundSummary"] = () => appLog.lastBackgroundSummary();
