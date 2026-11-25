import * as SQLite from "expo-sqlite";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS playback_current (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  workspace_id TEXT NOT NULL,
  folder_id TEXT,
  file_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playback_recent (
  file_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder_id TEXT,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("incar.db").then(async (db) => {
      await db.execAsync(SCHEMA);
      return db;
    });
  }
  return dbPromise;
}
