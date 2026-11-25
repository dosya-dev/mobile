import * as SQLite from "expo-sqlite";
import { t, stripBidi } from "@/lib/i18n";

export type AssetStatus = "pending" | "queued" | "uploaded" | "skipped_large" | "error";

export interface LedgerRow {
  workspace_id: string;
  local_id: string;
  filename: string;
  size: number;
  created_at: number;
  fingerprint: string | null;
  status: AssetStatus;
  remote_file_id: string | null;
  attempts: number;
  last_error: string | null;
  mp_session: string | null;
  /**
   * 1 once this still has been asked whether it is a Live Photo (and its
   * paired video scheduled if so). Stills uploaded before pairing existed
   * carry 0, which is what the orchestrator's backfill looks for. Optional
   * because rows read before the column migration ran lack it.
   */
  pair_checked?: number;
  /** Set together while a job is in flight (status `queued`); cleared back to
   * null on `requeueToPending`. Optional for the same reason as pair_checked:
   * rows read before the column migration ran lack them. */
  session_id?: string | null;
  job_id?: string | null;
  staged_path?: string | null;
}

let dbP: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  if (!dbP) dbP = SQLite.openDatabaseAsync("backup.db");
  return dbP;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS backup_assets (
  workspace_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  remote_file_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  mp_session TEXT,
  pair_checked INTEGER NOT NULL DEFAULT 0,
  session_id TEXT, job_id TEXT, staged_path TEXT,
  PRIMARY KEY (workspace_id, local_id)
);`;

export async function openLedger(): Promise<void> {
  const d = await db();
  // Migrate a pre-workspace-scoped table (local_id PRIMARY KEY, no workspace_id):
  // its device-wide dedup state can't be attributed to a workspace, so drop it -
  // the next scan rebuilds per-workspace state and the server fingerprint check
  // prevents any re-upload (only a one-time re-fingerprint of existing assets).
  const cols = await d.getAllAsync<{ name: string }>(`PRAGMA table_info(backup_assets);`);
  const legacy = cols.length > 0 && !cols.some((c) => c.name === "workspace_id");
  if (legacy) {
    await d.execAsync(`DROP TABLE backup_assets;`);
  }
  await d.execAsync(SCHEMA);
  // Additive column for installs that created the table before Live Photo
  // pairing was tracked. CREATE TABLE IF NOT EXISTS leaves an EXISTING table as
  // it was, so the column has to be added by hand there.
  //
  // Only for a table that survived: a fresh install and the legacy path above
  // both just ran CREATE TABLE, which already carries the column - and `cols`
  // was read BEFORE the drop, so trusting it there asked SQLite to add a column
  // it had just created ("duplicate column name"). That rejection came out of
  // openLedger, which every runBackup awaits first, so it broke backup outright.
  const needsPairChecked = !legacy && cols.length > 0 && !cols.some((c) => c.name === "pair_checked");
  if (needsPairChecked) {
    try {
      await d.execAsync(`ALTER TABLE backup_assets ADD COLUMN pair_checked INTEGER NOT NULL DEFAULT 0;`);
    } catch {
      // Belt and braces: this runs on the path every backup depends on, so a
      // failed migration degrades (the Live Photo backfill re-probes stills)
      // rather than taking the whole ledger - and the engine - down with it.
    }
  }
  // Same additive-column story for the three columns that track a queued
  // background job, added after this table shape shipped.
  const needsSessionId = !legacy && cols.length > 0 && !cols.some((c) => c.name === "session_id");
  if (needsSessionId) {
    try {
      await d.execAsync(`ALTER TABLE backup_assets ADD COLUMN session_id TEXT;`);
    } catch {
      // Same belt and braces as pair_checked above.
    }
  }
  const needsJobId = !legacy && cols.length > 0 && !cols.some((c) => c.name === "job_id");
  if (needsJobId) {
    try {
      await d.execAsync(`ALTER TABLE backup_assets ADD COLUMN job_id TEXT;`);
    } catch {
      // Same belt and braces as pair_checked above.
    }
  }
  const needsStagedPath = !legacy && cols.length > 0 && !cols.some((c) => c.name === "staged_path");
  if (needsStagedPath) {
    try {
      await d.execAsync(`ALTER TABLE backup_assets ADD COLUMN staged_path TEXT;`);
    } catch {
      // Same belt and braces as pair_checked above.
    }
  }
}

/**
 * Record that a still has been checked for a Live Photo pair, so the next
 * scan does not probe it again. Set whether or not a pair was found.
 */
export async function markPairChecked(workspaceId: string, localId: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    `UPDATE backup_assets SET pair_checked = 1 WHERE workspace_id = ? AND local_id = ?`,
    workspaceId, localId,
  );
}

export async function upsertAsset(a: {
  workspace_id: string;
  local_id: string;
  filename: string;
  size: number;
  created_at: number;
}): Promise<void> {
  const d = await db();
  // INSERT OR IGNORE preserves an existing row's status/fingerprint (idempotent scan).
  await d.runAsync(
    `INSERT OR IGNORE INTO backup_assets (workspace_id, local_id, filename, size, created_at) VALUES (?, ?, ?, ?, ?)`,
    a.workspace_id, a.local_id, a.filename, a.size, a.created_at,
  );
}

export async function getAsset(workspaceId: string, localId: string): Promise<LedgerRow | null> {
  const d = await db();
  return (
    (await d.getFirstAsync<LedgerRow>(
      `SELECT * FROM backup_assets WHERE workspace_id = ? AND local_id = ?`,
      workspaceId, localId,
    )) ?? null
  );
}

/**
 * `size` exists because `seedAssets` writes 0: a scan knows an asset's id and
 * date but not its byte count, which is only learned when the file is staged.
 * A row that never gets queued (deduped on the server, over the size cap, or
 * refused) would otherwise keep that 0 forever, and everything that sums sizes
 * (pendingTotals, reclaim) would under-report it. COALESCE so callers that do
 * not know the size leave the stored one alone.
 */
export async function setStatus(
  workspaceId: string,
  localId: string,
  status: AssetStatus,
  extra?: { remoteFileId?: string | null; fingerprint?: string | null; lastError?: string | null; incAttempts?: boolean; size?: number | null },
): Promise<void> {
  const d = await db();
  await d.runAsync(
    `UPDATE backup_assets
       SET status = ?, remote_file_id = COALESCE(?, remote_file_id),
           fingerprint = COALESCE(?, fingerprint), last_error = ?,
           attempts = attempts + ?, size = COALESCE(?, size)
     WHERE workspace_id = ? AND local_id = ?`,
    status, extra?.remoteFileId ?? null, extra?.fingerprint ?? null, extra?.lastError == null ? null : stripBidi(extra.lastError),
    extra?.incAttempts ? 1 : 0, extra?.size ?? null, workspaceId, localId,
  );
}

export async function setMpSession(workspaceId: string, localId: string, json: string | null): Promise<void> {
  const d = await db();
  await d.runAsync(
    `UPDATE backup_assets SET mp_session = ? WHERE workspace_id = ? AND local_id = ?`,
    json, workspaceId, localId,
  );
}

export async function countByStatus(workspaceId: string | null): Promise<Record<AssetStatus, number>> {
  const out: Record<AssetStatus, number> = { pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 0 };
  if (!workspaceId) return out;
  await openLedger(); // ensure backup_assets exists (Backup tab can open before any backup run)
  const d = await db();
  // `pair` flags a Live Photo's paired-video row (livePhotoLedgerId: `<id>#video`).
  const rows = await d.getAllAsync<{ status: AssetStatus; pair: number; n: number }>(
    `SELECT status, (local_id LIKE '%#video') AS pair, COUNT(*) AS n
       FROM backup_assets WHERE workspace_id = ? GROUP BY status, pair`,
    workspaceId,
  );
  for (const r of rows) {
    // A paired video is a second row for ONE library item. Counting it as
    // backed up or pending makes every Live Photo worth two on the dashboard
    // (and pushes "uploaded" past the library size). A pair that failed or was
    // too large is still a real outcome the user has to see, so those count.
    if (r.pair && (r.status === "uploaded" || r.status === "pending" || r.status === "queued")) continue;
    out[r.status] += r.n;
  }
  return out;
}

/**
 * What is still waiting to be backed up, and how big it is.
 *
 * For spec §5.9's `backup_failed`, whose body is "{pendingCount} item(s)
 * ({pendingSize}) is/are waiting". Read from the LEDGER rather than from the
 * upload store on purpose: the store holds only what the paused run had in
 * hand - a few hundred items under backpressure - while the honest answer to
 * "what has not been backed up" is every asset this workspace has scanned and
 * not yet sent.
 *
 * `error` counts with `pending`: a failed asset re-enters the next run, so from
 * the reader's point of view it is still waiting. `queued` counts too: it has
 * a job in flight, not a completed upload.
 */
export async function pendingTotals(workspaceId: string | null): Promise<{ count: number; bytes: number }> {
  if (!workspaceId) return { count: 0, bytes: 0 };
  await openLedger();
  const d = await db();
  const row = await d.getFirstAsync<{ n: number; bytes: number | null }>(
    `SELECT COUNT(*) AS n, SUM(size) AS bytes FROM backup_assets
     WHERE workspace_id = ? AND status IN ('pending', 'queued', 'error')`,
    workspaceId,
  );
  return { count: row?.n ?? 0, bytes: row?.bytes ?? 0 };
}

/** Ledger rows for a whole scan, metadata only (size 0 until staged). Lets the
 * dashboard count down from the first second and the planner pick from the
 * whole library rather than from what one throttled scan reached. */
export async function seedAssets(workspaceId: string, assets: { local_id: string; filename: string; created_at: number }[]): Promise<void> {
  if (assets.length === 0) return;
  const d = await db();
  for (let i = 0; i < assets.length; i += 200) {
    const chunk = assets.slice(i, i + 200);
    await d.runAsync(
      `INSERT OR IGNORE INTO backup_assets (workspace_id, local_id, filename, size, created_at) VALUES ${chunk.map(() => "(?, ?, ?, 0, ?)").join(",")}`,
      ...chunk.flatMap((a) => [workspaceId, a.local_id, a.filename, a.created_at]),
    );
  }
}

/**
 * Pending rows this workspace can still plan a job for: not past the retry
 * cap, oldest first.
 *
 * A Live Photo's paired video (`<localId>#video`) is included. It is first
 * staged alongside its still, but once it has a row of its own it retries like
 * any other asset - and excluding it here meant a pair whose job failed went
 * back to `pending` and was then never planned again.
 *
 * `attempts ASC` comes FIRST, before the date: a row that keeps failing (an
 * iCloud original that will not download, a corrupt asset) would otherwise sit
 * at the head of the date order and occupy a slot in every batch forever,
 * while the rows behind it never got planned at all. Sorting the tried ones to
 * the back makes every batch spend its slots on assets that have not been
 * tried yet, and retires the stuck ones at the attempt cap.
 */
export async function listPlannable(workspaceId: string, limit: number, maxAttempts: number): Promise<LedgerRow[]> {
  await openLedger();
  const d = await db();
  return await d.getAllAsync<LedgerRow>(
    `SELECT * FROM backup_assets
      WHERE workspace_id = ? AND status = 'pending' AND attempts < ?
      ORDER BY attempts ASC, created_at ASC, local_id ASC LIMIT ?`,
    workspaceId, maxAttempts, limit,
  );
}

/**
 * Charges a failed try to a row that must STAY plannable.
 *
 * `setStatus(..., "error")` cannot be used for this: `listPlannable` selects
 * `pending` only, so an `error` row leaves the queue for good and is only
 * released by the failed-items screen. A staging failure is not that - the
 * asset may well read next time (an iCloud original still downloading) - but
 * it must still cost an attempt, or a permanently unreadable row is planned,
 * fails and is planned again in an endless loop.
 */
export async function bumpAttempts(workspaceId: string, localId: string, lastError: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    `UPDATE backup_assets SET attempts = attempts + 1, last_error = ?
      WHERE workspace_id = ? AND local_id = ?`,
    stripBidi(lastError), workspaceId, localId,
  );
}

/**
 * Stills that are backed up but have never been asked whether they are Live
 * Photos, newest first.
 *
 * These are invisible to `listPlannable`, which only ever returns `pending`
 * rows: an `uploaded` still is finished as far as the planner is concerned, so
 * without this pass the motion half of every Live Photo backed up before
 * pairing existed is lost for good. Paired-video rows are excluded - a `#video`
 * row is the pair, it does not have one of its own.
 */
export async function listUploadedUnpaired(workspaceId: string, limit: number): Promise<LedgerRow[]> {
  await openLedger();
  const d = await db();
  return await d.getAllAsync<LedgerRow>(
    `SELECT * FROM backup_assets
      WHERE workspace_id = ? AND status = 'uploaded' AND pair_checked = 0
        AND local_id NOT LIKE '%#video'
      ORDER BY created_at DESC LIMIT ?`,
    workspaceId, limit,
  );
}

/** Records that an asset has a background upload job in flight. */
export async function markQueued(workspaceId: string, localId: string, q: { sessionId: string; jobId: string; stagedPath: string; fingerprint: string | null; size: number }): Promise<void> {
  const d = await db();
  await d.runAsync(
    `UPDATE backup_assets SET status = 'queued', session_id = ?, job_id = ?, staged_path = ?,
        fingerprint = COALESCE(?, fingerprint), size = ?
      WHERE workspace_id = ? AND local_id = ?`,
    q.sessionId, q.jobId, q.stagedPath, q.fingerprint, q.size, workspaceId, localId,
  );
}

/** Looks a batch of jobs up by id, across every workspace - the callback that
 * reports a job's outcome only knows the job id, not which workspace queued
 * it. */
export async function getByJobIds(jobIds: string[]): Promise<LedgerRow[]> {
  if (jobIds.length === 0) return [];
  await openLedger();
  const d = await db();
  const out: LedgerRow[] = [];
  for (let i = 0; i < jobIds.length; i += 100) {
    const chunk = jobIds.slice(i, i + 100);
    out.push(...await d.getAllAsync<LedgerRow>(
      `SELECT * FROM backup_assets WHERE job_id IN (${chunk.map(() => "?").join(",")})`, ...chunk,
    ));
  }
  return out;
}

/** Sends a queued asset back to pending after its job failed, clearing the job
 * bookkeeping so it does not look still-in-flight.
 *
 * `charge` (default true) adds an attempt. Pass false for interruptions that
 * say nothing about the asset - the user pressing Stop, a job iOS dropped
 * over a relaunch, an object the API never registered - or five such
 * interruptions retire a perfectly good photo. */
export async function requeueToPending(
  workspaceId: string,
  localId: string,
  lastError: string,
  opts: { charge?: boolean } = {},
): Promise<void> {
  const d = await db();
  const charge = opts.charge !== false;
  await d.runAsync(
    `UPDATE backup_assets SET status = 'pending', session_id = NULL, job_id = NULL, staged_path = NULL,
        last_error = ?${charge ? ", attempts = attempts + 1" : ""}
      WHERE workspace_id = ? AND local_id = ?`,
    stripBidi(lastError), workspaceId, localId,
  );
}

/**
 * Pending rows past the attempt cap are invisible: listPlannable skips them
 * and the Failed screen lists only `error`. Flip them to `error` so the user
 * sees them and Retry (resetForRetry) can release them. Called by the planner
 * before it picks a batch.
 */
export async function retireExhausted(workspaceId: string, maxAttempts: number): Promise<number> {
  await openLedger();
  const d = await db();
  const res = await d.runAsync(
    `UPDATE backup_assets
        SET status = 'error', last_error = COALESCE(last_error, ?)
      WHERE workspace_id = ? AND status = 'pending' AND attempts >= ?`,
    t("common.error.gaveUpAfterRepeatedFailures"), workspaceId, maxAttempts,
  );
  return res.changes ?? 0;
}

/**
 * Batch point-lookups for a scan batch: one IN query per 100 assets instead of
 * one query per asset - the difference between ~20k and ~200 SQLite round-trips
 * on a full scan of a big library (keeps the hourly background task cheap and
 * inside its iOS execution budget).
 */
export async function getAssetsBulk(workspaceId: string, ids: string[]): Promise<Map<string, LedgerRow>> {
  await openLedger();
  const d = await db();
  const out = new Map<string, LedgerRow>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await d.getAllAsync<LedgerRow>(
      `SELECT * FROM backup_assets WHERE workspace_id = ? AND local_id IN (${chunk.map(() => "?").join(",")})`,
      workspaceId,
      ...chunk,
    );
    for (const r of rows) out.set(r.local_id, r);
  }
  return out;
}

/**
 * Rows in the given statuses, newest first. Powers the failed-items screen,
 * where a permanently-stuck asset finally becomes visible and actionable.
 */
export async function listByStatus(
  workspaceId: string,
  statuses: AssetStatus[],
  limit = 200,
): Promise<LedgerRow[]> {
  // An empty status list must return nothing, not everything - an unguarded
  // `IN ()` would be a syntax error, and "no filter" is the wrong reading.
  if (statuses.length === 0) return [];
  await openLedger();
  const d = await db();
  return await d.getAllAsync<LedgerRow>(
    `SELECT * FROM backup_assets
      WHERE workspace_id = ? AND status IN (${statuses.map(() => "?").join(",")})
      ORDER BY created_at DESC LIMIT ?`,
    workspaceId, ...statuses, limit,
  );
}

/**
 * Releases permanently-failed assets so the next scan picks them up again.
 *
 * Zeroing `attempts` is the part that matters: past MAX_BACKUP_ATTEMPTS the
 * scan skips an asset forever, so clearing the status alone would change
 * nothing.
 *
 * Only `error` rows are reset. A `skipped_large` row would be re-skipped by the
 * very next scan unless the size cap itself changes, so the failed screen sends
 * the user to the cap instead of offering a retry that cannot work.
 */
export async function resetForRetry(workspaceId: string, localIds?: string[]): Promise<number> {
  await openLedger();
  const d = await db();
  const scope = localIds?.length ? ` AND local_id IN (${localIds.map(() => "?").join(",")})` : "";
  const res = await d.runAsync(
    `UPDATE backup_assets
        SET status = 'pending', attempts = 0, last_error = NULL
      WHERE workspace_id = ? AND status = 'error'${scope}`,
    workspaceId, ...(localIds ?? []),
  );
  return res.changes ?? 0;
}

/**
 * Assets that are backed up and could be removed from the device to reclaim
 * space, biggest first. Server confirmation happens separately in reclaim.ts -
 * a row here is a candidate, not a decision.
 */
export async function listReclaimable(workspaceId: string): Promise<LedgerRow[]> {
  await openLedger();
  const d = await db();
  return await d.getAllAsync<LedgerRow>(
    `SELECT * FROM backup_assets
      WHERE workspace_id = ? AND status = 'uploaded' AND remote_file_id IS NOT NULL
      ORDER BY size DESC`,
    workspaceId,
  );
}

/**
 * Every workspace this install has rows for.
 *
 * The settings cannot answer this: a workspace taken out of the destination
 * list still has queued rows and staged copies behind them, and deriving the
 * sweep set from the settings left both orphaned - the rows queued forever,
 * the files holding the staging budget until the app was deleted.
 */
export async function distinctWorkspaceIds(): Promise<string[]> {
  await openLedger();
  const d = await db();
  const rows = await d.getAllAsync<{ workspace_id: string }>(`SELECT DISTINCT workspace_id FROM backup_assets`);
  return rows.map((r) => r.workspace_id);
}

/** Drops this workspace's not-yet-started rows. Used when the filters change:
 * rows seeded under the old filters must not keep uploading under the new
 * ones. `queued` rows have a job in flight and are left alone; `uploaded`,
 * `error` and `skipped_large` rows are history and are left alone too. */
export async function deletePending(workspaceId: string): Promise<number> {
  await openLedger();
  const d = await db();
  const res = await d.runAsync(
    `DELETE FROM backup_assets WHERE workspace_id = ? AND status = 'pending'`,
    workspaceId,
  );
  return res.changes ?? 0;
}

/** Account purge (sign-out): wipe every workspace's rows. Server-side
 * fingerprint dedup re-links files on the next sign-in without re-uploading. */
export async function clearLedger(): Promise<void> {
  await openLedger();
  const d = await db();
  await d.runAsync(`DELETE FROM backup_assets`);
}
