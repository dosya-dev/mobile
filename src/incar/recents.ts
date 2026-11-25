import { getDb } from "./db";

export interface CurrentPlayback {
  workspaceId: string;
  folderId: string | null;
  fileId: string;
  title: string;
  sourceName: string;
  positionSeconds: number;
  durationSeconds: number | null;
  updatedAt: number;
}
export type NewCurrentPlayback = Omit<CurrentPlayback, "updatedAt">;

export interface RecentEntry {
  fileId: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
  sourceName: string;
  updatedAt: number;
}
export type NewRecentEntry = Omit<RecentEntry, "updatedAt">;

const RECENT_CAP = 20;

interface CurrentRow {
  workspace_id: string;
  folder_id: string | null;
  file_id: string;
  title: string;
  source_name: string;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: number;
}

export async function getCurrentPlayback(): Promise<CurrentPlayback | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CurrentRow>(
    "SELECT workspace_id, folder_id, file_id, title, source_name, position_seconds, duration_seconds, updated_at FROM playback_current WHERE id = 1",
  );
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    folderId: row.folder_id,
    fileId: row.file_id,
    title: row.title,
    sourceName: row.source_name,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    updatedAt: row.updated_at,
  };
}

export async function setCurrentPlayback(p: NewCurrentPlayback, updatedAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO playback_current
       (id, workspace_id, folder_id, file_id, title, source_name, position_seconds, duration_seconds, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.workspaceId, p.folderId, p.fileId, p.title, p.sourceName, p.positionSeconds, p.durationSeconds, updatedAt,
  );
}

/** Dropped (not written) if `fileId` isn't the current track — a checkpoint racing a track change must not stamp the wrong track's position. */
export async function updatePlaybackPosition(fileId: string, positionSeconds: number, updatedAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE playback_current SET position_seconds = ?, updated_at = ? WHERE id = 1 AND file_id = ?",
    positionSeconds, updatedAt, fileId,
  );
}

export async function pushRecent(entry: NewRecentEntry, updatedAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO playback_recent (file_id, workspace_id, folder_id, title, source_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    entry.fileId, entry.workspaceId, entry.folderId, entry.title, entry.sourceName, updatedAt,
  );
  await db.runAsync(
    `DELETE FROM playback_recent WHERE file_id NOT IN (
       SELECT file_id FROM playback_recent ORDER BY updated_at DESC LIMIT ?
     )`,
    RECENT_CAP,
  );
}

interface RecentRow {
  file_id: string;
  workspace_id: string;
  folder_id: string | null;
  title: string;
  source_name: string;
  updated_at: number;
}

/**
 * Scoped to one workspace: `playback_recent` is a single device-wide table, so
 * without the filter a member of several workspaces sees the other workspaces'
 * tracks mixed into the active one's Recently Played (and tapping one would
 * fetch a file the active workspace may not even grant access to).
 */
export async function getRecent(workspaceId: string, limit = RECENT_CAP): Promise<RecentEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RecentRow>(
    "SELECT file_id, workspace_id, folder_id, title, source_name, updated_at FROM playback_recent WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?",
    workspaceId,
    limit,
  );
  return rows.map((r) => ({
    fileId: r.file_id,
    workspaceId: r.workspace_id,
    folderId: r.folder_id,
    title: r.title,
    sourceName: r.source_name,
    updatedAt: r.updated_at,
  }));
}

/**
 * Wipes both playback tables. Wired into purgeAccountData (src/auth/purge.ts) so
 * a signed-out account's Continue Listening / Recently Played can't surface to
 * whoever signs in next on the same device - same contract, and the same
 * DELETE-the-rows shape, as the backup ledger's clearLedger().
 */
export async function clearIncarHistory(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM playback_current");
  await db.runAsync("DELETE FROM playback_recent");
}
