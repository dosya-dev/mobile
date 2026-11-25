import * as SQLite from "expo-sqlite";
import { stripBidi } from "@/lib/i18n";
import { fence, type OfflineSession } from "./session";
import type { DesiredFile, OfflineFileRow, OfflineFolderRow, PinMember, PinRow, PinStatus, RenditionState } from "./types";

/**
 * The offline store's SQLite database: pins, which pin covers which file, the
 * files themselves, and the folder tree for browsing without a network.
 *
 * No locking in here. Every WRITE is called by someone holding withCommit
 * (session.ts); reads may run anywhere. The file lives in the account's own
 * root (`<offline>/<account>/offline.db`), so wiping the account wipes it.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pins (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_checked_at INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS pin_revisions (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pin_members (
  pin_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  missing_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pin_id, file_id)
);
CREATE INDEX IF NOT EXISTS pin_members_file ON pin_members (file_id);
CREATE TABLE IF NOT EXISTS files (
  file_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder_id TEXT,
  name TEXT NOT NULL,
  extension TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  remote_version INTEGER NOT NULL,
  saved_version INTEGER,
  saved_size INTEGER,
  rendition TEXT NOT NULL DEFAULT 'none',
  rendition_version INTEGER,
  rendition_size INTEGER,
  updated_at INTEGER NOT NULL,
  saved_ext TEXT
);
CREATE INDEX IF NOT EXISTS files_folder ON files (workspace_id, folder_id);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  PRIMARY KEY (pin_id, id)
);
CREATE INDEX IF NOT EXISTS folders_parent ON folders (workspace_id, parent_id);
`;

/**
 * Bumped with every schema change, and recorded in PRAGMA user_version.
 *  0 - the first build: no saved_ext.
 *  1 - saved_ext: the extension the saved bytes were written under, so a
 *      rename on the server (which keeps the version) cannot lose them.
 */
export const OFFLINE_SCHEMA_VERSION = 1;

async function migrate(d: SQLite.SQLiteDatabase): Promise<void> {
  const v = (await d.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
  if (v >= OFFLINE_SCHEMA_VERSION) {
    await d.execAsync(SCHEMA);
    return;
  }
  // CREATE TABLE IF NOT EXISTS leaves an existing table as it was, so columns
  // added since are added by hand, before the schema's indexes refer to them.
  await d.execAsync(SCHEMA);
  const cols = await d.getAllAsync<{ name: string }>("PRAGMA table_info(files)");
  if (!cols.some((c) => c.name === "saved_ext")) await d.execAsync("ALTER TABLE files ADD COLUMN saved_ext TEXT");
  await d.execAsync(`PRAGMA user_version = ${OFFLINE_SCHEMA_VERSION}`);
}

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/** What a read from a session that has ended rejects with. */
export const SESSION_ENDED = "offline: session ended";

function dbFor(s: OfflineSession): Promise<SQLite.SQLiteDatabase> {
  // An ended session never opens its database again. Opening is what creates
  // the file, so a late read from a fenced sync run would otherwise bring an
  // empty offline.db back into a directory sign-out had just wiped.
  if (!fence(s)) return Promise.reject(new Error(SESSION_ENDED));
  let p = open.get(s.root);
  if (!p) {
    p = (async () => {
      const d = await SQLite.openDatabaseAsync("offline.db", undefined, s.root);
      await migrate(d);
      return d;
    })();
    // A failed open must not be cached: the next call should try again (the
    // directory may simply not have existed yet).
    p.catch(() => { if (open.get(s.root) === p) open.delete(s.root); });
    open.set(s.root, p);
  }
  return p;
}

export async function openOfflineDb(s: OfflineSession): Promise<void> {
  await dbFor(s);
}

export async function schemaVersion(s: OfflineSession): Promise<number> {
  const d = await dbFor(s);
  return (await d.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
}

/**
 * Run `fn`'s writes as one SQLite transaction: all of them land, or none do.
 * A run killed mid-apply then leaves the database as it was, so the rerun
 * cannot, say, count the same membership miss twice.
 *
 * withTransactionAsync lets any query on the connection join the open
 * transaction. That is safe here only because every write already runs under
 * the commit lock (session.ts); what can interleave is reads.
 */
export async function inTransaction(s: OfflineSession, fn: () => Promise<void>): Promise<void> {
  const d = await dbFor(s);
  await d.withTransactionAsync(fn);
}

/** Close every open connection. Wiping an account's directory needs its database closed first. */
export async function closeOfflineDb(): Promise<void> {
  const all = [...open.values()];
  open.clear();
  for (const p of all) {
    try {
      await (await p).closeAsync();
    } catch {
      // An open that failed, or a database already gone: nothing to close.
    }
  }
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** SQLite caps bound parameters; 400 a statement stays well under every build's limit. */
function chunks<T>(xs: T[], n = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ── pins ────────────────────────────────────────────────────────────────────

export async function listPins(s: OfflineSession): Promise<PinRow[]> {
  const d = await dbFor(s);
  return d.getAllAsync<PinRow>(`SELECT * FROM pins ORDER BY created_at ASC, id ASC`);
}

/**
 * Create or re-create a pin. The revision is always one above anything this id
 * has ever had, including before an unpin, and is returned.
 */
export async function upsertPin(
  s: OfflineSession,
  row: Pick<PinRow, "id" | "kind" | "workspace_id" | "name" | "created_at">,
): Promise<number> {
  const d = await dbFor(s);
  const prev = await d.getFirstAsync<{ r: number | null }>(
    `SELECT MAX(r) AS r FROM (
       SELECT revision AS r FROM pins WHERE id = ?
       UNION ALL SELECT revision AS r FROM pin_revisions WHERE id = ?)`,
    row.id, row.id,
  );
  const revision = (prev?.r ?? 0) + 1;
  await d.runAsync(
    `INSERT INTO pins (id, kind, workspace_id, name, created_at, revision, status, last_checked_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, workspace_id = excluded.workspace_id,
       name = excluded.name, revision = excluded.revision, status = 'pending', last_error = NULL`,
    row.id, row.kind, row.workspace_id, stripBidi(row.name), row.created_at, revision,
  );
  await d.runAsync(
    `INSERT INTO pin_revisions (id, revision) VALUES (?, ?)
     ON CONFLICT (id) DO UPDATE SET revision = excluded.revision`,
    row.id, revision,
  );
  return revision;
}

export async function setPinStatus(s: OfflineSession, id: string, status: PinStatus, err?: string | null): Promise<void> {
  const d = await dbFor(s);
  await d.runAsync(
    `UPDATE pins SET status = ?, last_error = ? WHERE id = ?`,
    status, err == null ? null : stripBidi(err), id,
  );
}

export async function setPinChecked(s: OfflineSession, ids: string[], at: number): Promise<void> {
  if (ids.length === 0) return;
  const d = await dbFor(s);
  for (const c of chunks(ids)) {
    await d.runAsync(`UPDATE pins SET last_checked_at = ? WHERE id IN (${placeholders(c.length)})`, at, ...c);
  }
}

/**
 * Remove a pin with its memberships and folders. Returns the files no pin
 * covers any more; the caller removes their bytes and rows in the same commit.
 */
export async function deletePin(s: OfflineSession, pinId: string): Promise<string[]> {
  const d = await dbFor(s);
  await d.runAsync(`DELETE FROM pin_members WHERE pin_id = ?`, pinId);
  await d.runAsync(`DELETE FROM folders WHERE pin_id = ?`, pinId);
  await d.runAsync(`DELETE FROM pins WHERE id = ?`, pinId);
  return orphanedFiles(s);
}

/**
 * A pin the server says is gone: its memberships and folders go, but the row
 * stays (status "gone") so the user sees why it emptied and removes it
 * themselves. The revision is untouched - this is not a change the user made.
 */
export async function clearPinContents(s: OfflineSession, pinId: string): Promise<void> {
  const d = await dbFor(s);
  await d.runAsync(`DELETE FROM pin_members WHERE pin_id = ?`, pinId);
  await d.runAsync(`DELETE FROM folders WHERE pin_id = ?`, pinId);
}

/** The pin's current revision, or null when it no longer exists. */
export async function pinRevision(s: OfflineSession, pinId: string): Promise<number | null> {
  const d = await dbFor(s);
  const row = await d.getFirstAsync<{ revision: number }>(`SELECT revision FROM pins WHERE id = ?`, pinId);
  return row ? row.revision : null;
}

// ── membership ──────────────────────────────────────────────────────────────

export async function listMembers(s: OfflineSession): Promise<PinMember[]> {
  const d = await dbFor(s);
  return d.getAllAsync<PinMember>(`SELECT pin_id, file_id, missing_count FROM pin_members ORDER BY pin_id, file_id`);
}

/** Add memberships (a file pin covering its own file). Existing ones are reset to seen. */
export async function addMembers(s: OfflineSession, pinId: string, fileIds: string[]): Promise<void> {
  await applyMembers(s, pinId, fileIds, []);
}

/**
 * One pin's complete snapshot, applied: `present` files are members with a
 * clean count, `missingFiles` (members the snapshot did not list) take a miss,
 * and a second consecutive miss drops the membership.
 *
 * Deletes NOTHING but memberships. Whether a file leaves the phone is decided
 * once, by orphanedFiles, after every pin's changes are in - a file moving from
 * one pin to another in the same run must never be deleted on the way.
 */
export async function applyMembers(s: OfflineSession, pinId: string, present: string[], missingFiles: string[]): Promise<void> {
  const d = await dbFor(s);
  for (const c of chunks(present, 200)) {
    await d.runAsync(
      `INSERT INTO pin_members (pin_id, file_id, missing_count) VALUES ${c.map(() => "(?, ?, 0)").join(",")}
       ON CONFLICT (pin_id, file_id) DO UPDATE SET missing_count = 0 WHERE missing_count != 0`,
      ...c.flatMap((id) => [pinId, id]),
    );
  }
  for (const c of chunks(missingFiles)) {
    await d.runAsync(
      `UPDATE pin_members SET missing_count = missing_count + 1 WHERE pin_id = ? AND file_id IN (${placeholders(c.length)})`,
      pinId, ...c,
    );
  }
  if (missingFiles.length > 0) {
    await d.runAsync(`DELETE FROM pin_members WHERE pin_id = ? AND missing_count >= 2`, pinId);
  }
}

/** File rows no pin covers. Called once, after every membership change of a run is written. */
export async function orphanedFiles(s: OfflineSession): Promise<string[]> {
  const d = await dbFor(s);
  const rows = await d.getAllAsync<{ file_id: string }>(
    `SELECT f.file_id FROM files f
      WHERE NOT EXISTS (SELECT 1 FROM pin_members m JOIN pins p ON p.id = m.pin_id WHERE m.file_id = f.file_id)
      ORDER BY f.file_id`,
  );
  return rows.map((r) => r.file_id);
}

/** Whether any live pin still covers a file. The publish re-check. */
export async function hasLivePin(s: OfflineSession, fileId: string): Promise<boolean> {
  const d = await dbFor(s);
  const row = await d.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pin_members m JOIN pins p ON p.id = m.pin_id WHERE m.file_id = ?`,
    fileId,
  );
  return (row?.n ?? 0) > 0;
}

// ── files ───────────────────────────────────────────────────────────────────

export async function listFiles(s: OfflineSession): Promise<OfflineFileRow[]> {
  const d = await dbFor(s);
  return d.getAllAsync<OfflineFileRow>(`SELECT * FROM files ORDER BY file_id`);
}

export async function getFileRow(s: OfflineSession, id: string): Promise<OfflineFileRow | null> {
  const d = await dbFor(s);
  return d.getFirstAsync<OfflineFileRow>(`SELECT * FROM files WHERE file_id = ?`, id);
}

export async function listFilesIn(s: OfflineSession, workspaceId: string, folderId: string): Promise<OfflineFileRow[]> {
  const d = await dbFor(s);
  return d.getAllAsync<OfflineFileRow>(
    `SELECT * FROM files WHERE workspace_id = ? AND folder_id = ? ORDER BY name COLLATE NOCASE, file_id`,
    workspaceId, folderId,
  );
}

/**
 * The server's view of each file. The saved version and rendition are left
 * alone: only publishSaved moves those, after the bytes are in place.
 */
export async function upsertMeta(s: OfflineSession, rows: DesiredFile[]): Promise<void> {
  const d = await dbFor(s);
  // A run re-describes every covered file. Writing only the rows that changed
  // keeps a 10,000-file pin from rewriting 10,000 rows inside the lock.
  for (const c of chunks(rows, 40)) {
    await d.runAsync(
      `INSERT INTO files (file_id, workspace_id, folder_id, name, extension, mime_type, size_bytes, remote_version, updated_at)
       VALUES ${c.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}
       ON CONFLICT (file_id) DO UPDATE SET workspace_id = excluded.workspace_id, folder_id = excluded.folder_id,
         name = excluded.name, extension = excluded.extension, mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes, remote_version = excluded.remote_version, updated_at = excluded.updated_at
       WHERE files.workspace_id IS NOT excluded.workspace_id OR files.folder_id IS NOT excluded.folder_id
         OR files.name IS NOT excluded.name OR files.extension IS NOT excluded.extension
         OR files.mime_type IS NOT excluded.mime_type OR files.size_bytes IS NOT excluded.size_bytes
         OR files.remote_version IS NOT excluded.remote_version OR files.updated_at IS NOT excluded.updated_at`,
      ...c.flatMap((r) => [
        r.file_id, r.workspace_id, r.folder_id, stripBidi(r.name), r.extension, r.mime_type,
        r.size_bytes, r.current_version, r.updated_at,
      ]),
    );
  }
}

export async function deleteFileRows(s: OfflineSession, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const d = await dbFor(s);
  for (const c of chunks(ids)) {
    await d.runAsync(`DELETE FROM files WHERE file_id IN (${placeholders(c.length)})`, ...c);
  }
}

/**
 * Point the row at bytes that are now in place. A ready rendition is recorded
 * at the same version as the original - the one rule that keeps an office file
 * from previewing an older conversion of itself.
 */
export async function publishSaved(
  s: OfflineSession,
  fileId: string,
  v: { version: number; size: number; ext?: string | null; rendition: RenditionState; renditionSize: number | null },
): Promise<void> {
  const d = await dbFor(s);
  const ready = v.rendition === "ready";
  // `ext` is the extension the bytes were written under. Every later lookup
  // uses it, never the file's current name: a rename keeps the version, so
  // reading by the new name would look for a file that was never written.
  await d.runAsync(
    `UPDATE files SET saved_version = ?, saved_size = ?, saved_ext = ?, rendition = ?, rendition_version = ?, rendition_size = ?
      WHERE file_id = ?`,
    v.version, v.size, v.ext ?? null, v.rendition, ready ? v.version : null, ready ? v.renditionSize : null, fileId,
  );
}

export async function setRendition(
  s: OfflineSession,
  fileId: string,
  r: { rendition: RenditionState; version: number | null; size: number | null },
): Promise<void> {
  const d = await dbFor(s);
  await d.runAsync(
    `UPDATE files SET rendition = ?, rendition_version = ?, rendition_size = ? WHERE file_id = ?`,
    r.rendition, r.version, r.size, fileId,
  );
}

// ── folders ─────────────────────────────────────────────────────────────────

export async function replaceFolders(s: OfflineSession, pinId: string, rows: OfflineFolderRow[]): Promise<void> {
  const d = await dbFor(s);
  await d.runAsync(`DELETE FROM folders WHERE pin_id = ?`, pinId);
  for (const c of chunks(rows, 80)) {
    await d.runAsync(
      `INSERT OR REPLACE INTO folders (id, pin_id, workspace_id, parent_id, name) VALUES ${c.map(() => "(?, ?, ?, ?, ?)").join(",")}`,
      ...c.flatMap((r) => [r.id, pinId, r.workspace_id, r.parent_id, stripBidi(r.name)]),
    );
  }
}

export async function listFolders(s: OfflineSession): Promise<OfflineFolderRow[]> {
  const d = await dbFor(s);
  return d.getAllAsync<OfflineFolderRow>(`SELECT id, workspace_id, parent_id, name, pin_id FROM folders ORDER BY pin_id, id`);
}

/** Folders directly inside `folderId`, once each even when two pins both hold them. */
export async function listChildren(s: OfflineSession, workspaceId: string, folderId: string | null): Promise<OfflineFolderRow[]> {
  const d = await dbFor(s);
  return d.getAllAsync<OfflineFolderRow>(
    `SELECT id, workspace_id, parent_id, MIN(name) AS name, MIN(pin_id) AS pin_id FROM folders
      WHERE workspace_id = ? AND parent_id IS ?
      GROUP BY id ORDER BY name COLLATE NOCASE, id`,
    workspaceId, folderId,
  );
}

/** One folder's own row, if any pin holds it. */
export async function getFolder(s: OfflineSession, folderId: string): Promise<OfflineFolderRow | null> {
  const d = await dbFor(s);
  return d.getFirstAsync<OfflineFolderRow>(
    `SELECT id, workspace_id, parent_id, name, pin_id FROM folders WHERE id = ? ORDER BY pin_id LIMIT 1`,
    folderId,
  );
}
