import * as SQLite from "expo-sqlite";

export interface BackupRunRecord {
  id: string;
  workspace_name: string | null;
  uploaded: number;
  deduped: number;
  skipped_large: number;
  failed: number;
  at: number;
}

let dbP: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  if (!dbP) dbP = SQLite.openDatabaseAsync("backup.db");
  return dbP;
}

// Monotonic counter for id uniqueness within a run of the process - avoids
// Math.random() collisions when two runs land in the same second.
let seq = 0;

/** How many past runs the table keeps (and therefore the most the feed can page through). */
export const HISTORY_RETAINED = 100;

export async function openHistory(): Promise<void> {
  const d = await db();
  await d.execAsync(
    `CREATE TABLE IF NOT EXISTS backup_runs (
       id TEXT PRIMARY KEY,
       workspace_name TEXT,
       uploaded INTEGER NOT NULL DEFAULT 0,
       deduped INTEGER NOT NULL DEFAULT 0,
       skipped_large INTEGER NOT NULL DEFAULT 0,
       failed INTEGER NOT NULL DEFAULT 0,
       at INTEGER NOT NULL
     );`,
  );
}

export async function recordBackupRun(r: Omit<BackupRunRecord, "id">): Promise<void> {
  await openHistory();
  const d = await db();
  seq += 1;
  const id = `run_${r.at}_${seq}`;
  await d.runAsync(
    `INSERT INTO backup_runs (id, workspace_name, uploaded, deduped, skipped_large, failed, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, r.workspace_name, r.uploaded, r.deduped, r.skipped_large, r.failed, r.at,
  );
  // Bounded history: the activity feed pages through what is kept here; a year
  // of hourly runs must not grow the table (and the app's disk footprint)
  // forever.
  await d.runAsync(
    `DELETE FROM backup_runs WHERE id NOT IN (SELECT id FROM backup_runs ORDER BY at DESC LIMIT ?)`,
    HISTORY_RETAINED,
  );
}

/**
 * Newest first. The default is the whole retained table: the activity feed
 * pages through these client-side (six at a time), so cutting the read at 30
 * would silently hide two thirds of the runs the device still has.
 */
export async function getBackupHistory(limit = HISTORY_RETAINED): Promise<BackupRunRecord[]> {
  await openHistory();
  const d = await db();
  return d.getAllAsync<BackupRunRecord>(`SELECT * FROM backup_runs ORDER BY at DESC LIMIT ?`, limit);
}

/** Account purge (sign-out): run history is not account-scoped, so it must
 * be wiped wholesale or the next account would see this account's runs. */
export async function clearHistory(): Promise<void> {
  await openHistory();
  const d = await db();
  await d.runAsync(`DELETE FROM backup_runs`);
}
