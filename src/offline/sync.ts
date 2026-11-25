import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { offlineRequest } from "./http";
import { isUnmetered } from "./network";
import { ApiError } from "@/api/errors";
import { getAccessToken, refreshSession } from "@/auth/authStore";
import { filePreviewPdfUrl } from "@/files/fileUrl";
import { fileKind } from "@/files/format";
import { MAX_PREVIEW_ATTEMPTS, PREVIEW_RETRY_SECONDS } from "@/viewer/officePreview";
import { reportError } from "@/telemetry/sentry";
import { cancelTasksFor, currentSession, fence, registerTask, withCommit, type CancellableTask, type OfflineSession } from "./session";
import {
  applyMembers, clearPinContents, deleteFileRows, getFileRow, hasLivePin, inTransaction, listFiles, listFolders, listMembers,
  listPins, orphanedFiles, pinRevision, publishSaved, replaceFolders, SESSION_ENDED, setPinChecked, setPinStatus, upsertMeta,
} from "./db";
import {
  bytesRetained, ensureRoot, extOf, finalPath, moveIntoPlace, removeFileBytes, sweep, sweepOrphanRoots, tempPath, verify,
  wipeAccount,
} from "./store";
import { accessIdsToAsk, planSync, type MembershipCheck, type SyncPlan } from "./plan";
import { checkAccess, checkMembership } from "./remote";
import { useOfflineStore } from "./offlineStore";
import { isAutoWorkHeld } from "@/perf/heatHold";
import type { DesiredFile, PinStatus, RenditionState } from "./types";

/**
 * One offline sync run.
 *
 *   sweep -> CHECK (any connection) -> APPLY (one commit) -> TRANSFER (Wi-Fi
 *   unless mobile data is allowed) -> PUBLISH each file (one commit each)
 *
 * The check phase decides what the phone may keep; the transfer phase only ever
 * adds. A download that finishes after its pin was removed, its access was
 * denied, or the account signed out is thrown away inside the commit lock, so
 * nothing a slow transfer does can outlive the decision that cancelled it.
 *
 * Nothing here may break an open, a listing or a sign-out: every failure ends
 * the run quietly and leaves the saved copies as they were.
 */

/** A transfer may only run while this much stays free on the device. */
export const FREE_SPACE_FLOOR_BYTES = 1024 ** 3;
/** Files per download-manifest call: its presigned URLs live 900 s, so the batch must finish well inside that. */
export const MANIFEST_BATCH = 50;
/** Room set aside for an office file's PDF before it is fetched. Its real size is checked after. */
export const RENDITION_RESERVE = (sourceBytes: number) => Math.max(sourceBytes, 5 * 1024 ** 2);
/** Re-read free space after this many bytes of one download, so another app filling the disk is noticed. */
const FREE_PROBE_BYTES = 8 * 1024 ** 2;

/**
 * Time limits. A download that makes no progress for STALL_MS is cancelled
 * (a dead socket otherwise holds the run forever), and a whole run past
 * RUN_CEILING_MS stops transferring and lets the next trigger start afresh.
 * Requests have their own limit (http.ts).
 */
const timeouts = { stallMs: 60_000, runCeilingMs: 15 * 60_000, lateWriteGraceMs: 5_000 };
/** Test hook. */
export function __setTimeoutsForTests(t: Partial<typeof timeouts>): void {
  Object.assign(timeouts, t);
}


/**
 * Would the retained offline storage stay inside the budget after this file?
 * The version being replaced (and its PDF) stops counting, so a same-size edit
 * always fits a full budget.
 */
export function fitsBudget(i: { retained: number; oldSaved: number; oldRendition: number; newSize: number; newRendition: number; budget: number | null }): boolean {
  return i.budget === null || i.retained - i.oldSaved - i.oldRendition + i.newSize + i.newRendition <= i.budget;
}

/** Temporary room: the old copy is still on disk (already counted as used in `free`) until the new one replaces it. */
export function fitsHeadroom(i: { free: number; incoming: number }): boolean {
  return i.free - i.incoming >= FREE_SPACE_FLOOR_BYTES;
}

export type SyncReason = "foreground" | "background" | "pin" | "manual" | "network";

let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Test hook: the wait between conversion polls. */
export function __setSleepForTests(fn: (ms: number) => Promise<void>): void {
  sleep = fn;
}

let running: Promise<void> | null = null;
let again = false;
/** Someone asked for the run in progress: it does not give way to music or heat. */
let userAsked = false;

const isAutomatic = (reason: SyncReason) => reason === "foreground" || reason === "background" || reason === "network";

/**
 * Run a sync, or join the one already running. A call that arrives mid-run
 * (a pin, Sync now) also earns one more pass afterwards, so it is never
 * answered by a run that started before it. Never rejects.
 */
export function runOfflineSync(opts: { reason: SyncReason }): Promise<void> {
  if (running) {
    again = true;
    if (!isAutomatic(opts.reason)) userAsked = true;
    return running;
  }
  if (isAutomatic(opts.reason) && isAutoWorkHeld()) return Promise.resolve();
  userAsked = !isAutomatic(opts.reason);
  running = (async () => {
    try {
      do {
        again = false;
        const run = { abandoned: false, ctx: null as TransferCtx | null };
        let timer: ReturnType<typeof setTimeout> | null = null;
        const ceiling = new Promise<"ceiling">((r) => { timer = setTimeout(() => r("ceiling"), timeouts.runCeilingMs); });
        try {
          const outcome = await Promise.race([runOnce(opts.reason, run).then(() => "done" as const), ceiling]);
          if (outcome === "ceiling") {
            // Something is stuck past every per-request and per-download
            // limit. Stop this run's transfers and let the next trigger start
            // a new one; its writes still go through the commit lock, and its
            // publishes re-check everything, so the stray run can do no harm.
            run.abandoned = true;
            if (run.ctx) {
              run.ctx.stop = run.ctx.stop ?? "session";
              void run.ctx.active?.cancelAsync().catch(() => {});
            }
            again = false;
          }
        } catch (e) {
          // Signing out mid-run ends the session under it, on purpose.
          if (!(e instanceof Error && e.message === SESSION_ENDED)) reportError(e, { area: "offline-sync" });
        } finally {
          if (timer) clearTimeout(timer);
        }
      } while (again);
    } finally {
      running = null;
      useOfflineStore.getState().setProgress(null);
      await useOfflineStore.getState().refresh().catch(() => {});
    }
  })();
  return running;
}

interface NetState { connected: boolean; onWifi: boolean }

async function readNetwork(): Promise<NetState> {
  try {
    const n = await Network.getNetworkStateAsync();
    return { connected: n.isConnected ?? false, onWifi: isUnmetered(n.type) };
  } catch {
    // Unknown is treated as offline: a run that cannot tell is a run that waits.
    return { connected: false, onWifi: false };
  }
}

const preparedRoots = new Set<string>();

interface RunHandle { abandoned: boolean; ctx: TransferCtx | null }

async function runOnce(reason: SyncReason, run: RunHandle = { abandoned: false, ctx: null }): Promise<void> {
  const s = currentSession();
  if (!s) return;
  await useOfflineStore.getState().hydrate();
  if (!preparedRoots.has(s.root)) {
    await ensureRoot(s);
    // Another account's directory with no session of its own is left over
    // from an app killed before its purge finished. Only one account is ever
    // signed in, so it is never anyone's live data.
    await sweepOrphanRoots(s);
    preparedRoots.add(s.root);
  }

  // 1. Whatever a killed run left in tmp/ goes first, before anything new lands.
  const swept = await withCommit(s, async () => { await sweep(s, await listFiles(s)); return true; });
  if (!swept) return;

  const pins = await listPins(s);
  if (pins.length === 0) return;

  // 2. Offline: nothing to learn. A pin a killed run left mid-check goes back
  // to waiting; one that finished keeps its status and its "last checked".
  const net = await readNetwork();
  if (!net.connected) {
    await withCommit(s, async () => {
      for (const p of pins) if (p.status === "checking" || p.status === "transferring") await setPinStatus(s, p.id, "pending");
    });
    return;
  }

  await withCommit(s, async () => {
    for (const p of pins) await setPinStatus(s, p.id, "checking", p.last_error);
  });
  await useOfflineStore.getState().refresh();

  // 3. Check: membership, then access for everything saved or wanted.
  const checks = await checkMembership(pins, await listFolders(s));
  const access = await checkAccess(accessIdsToAsk(await listFiles(s), checks));

  // 4. Apply, in one commit.
  const applied = await withCommit(s, () => applyChecks(s, checks, access));
  if (!applied) return;
  await useOfflineStore.getState().refresh();

  const blocked = new Map<string, PinStatus>(applied.blocked);
  try {
    if (!run.abandoned) await transferAll(s, applied.plan, blocked, reason, run);
  } finally {
    await withCommit(s, () => settleStatuses(s, blocked));
  }
}

/**
 * The apply step. Inside the commit lock, in exactly this order:
 *  1. drop every check whose pin was removed or re-pinned since it began;
 *  2. plan from the remaining checks against the database as it is NOW;
 *  3. gone pins lose their memberships;
 *  4. every pin's membership changes are written;
 *  5. only then are orphans computed, and orphans plus denied files removed;
 *  6. metadata, and the checked-at time of the pins that were checked.
 *
 * Planning here rather than before taking the lock means the plan can never
 * describe memberships an unpin has already removed.
 */
async function applyChecks(s: OfflineSession, checks: MembershipCheck[], access: Awaited<ReturnType<typeof checkAccess>>) {
  const fresh: MembershipCheck[] = [];
  for (const c of checks) {
    const now = await pinRevision(s, c.pinId);
    if (now !== null && now === c.revision) fresh.push(c);
  }
  const plan = planSync(fresh, access, await listFiles(s), await listMembers(s));
  const blocked: [string, PinStatus][] = [];
  let victims: string[] = [];

  // Every row change of the apply is one transaction: a run killed half way
  // leaves the database exactly as it was, so the rerun neither double-counts
  // a miss nor finds memberships dropped without their orphans removed.
  await inTransaction(s, async () => {
    for (const id of plan.goneByPin) {
      await clearPinContents(s, id);
      blocked.push([id, "gone"]);
    }
    for (const m of plan.membership) await applyMembers(s, m.pinId, m.present, m.missing);
    for (const f of plan.folders) await replaceFolders(s, f.pinId, f.rows);

    const orphans = await orphanedFiles(s);
    victims = [...new Set([...orphans, ...plan.denied])];
    if (victims.length > 0) await deleteFileRows(s, victims);

    await upsertMeta(s, plan.upsertMeta);
    await setPinChecked(s, fresh.filter((c) => c.outcome !== "skipped").map((c) => c.pinId), Date.now());
  });
  for (const c of fresh) if (c.outcome === "skipped") blocked.push([c.pinId, "error"]);

  // Bytes after the rows are committed, still inside the commit lock. A kill
  // in between leaves bytes with no row, which the next sweep removes.
  if (victims.length > 0) {
    await cancelTasksFor(victims);
    for (const id of victims) await removeFileBytes(s, id);
  }
  return { plan, blocked };
}

/** Pins that cover each file, read once after apply. */
async function pinsByFile(s: OfflineSession): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const m of await listMembers(s)) {
    const list = out.get(m.file_id);
    if (list) list.push(m.pin_id);
    else out.set(m.file_id, [m.pin_id]);
  }
  return out;
}

type StopReason = "network" | "no_space" | "over_budget" | "session" | "heat";

/** Whether transfers may run on this connection right now, read fresh. */
async function transfersAllowed(): Promise<{ ok: boolean; connected: boolean }> {
  const net = await readNetwork();
  return { ok: net.connected && (net.onWifi || useOfflineStore.getState().allowCellular), connected: net.connected };
}

async function transferAll(s: OfflineSession, plan: SyncPlan, blocked: Map<string, PinStatus>, _reason: SyncReason, run: RunHandle): Promise<void> {
  const queue = plan.transfer;
  if (queue.length === 0) return;
  const byFile = await pinsByFile(s);
  const markPins = (files: DesiredFile[], status: PinStatus, overwrite = true) => {
    for (const f of files) for (const p of byFile.get(f.file_id) ?? []) {
      if (overwrite || !blocked.has(p)) blocked.set(p, status);
    }
  };

  // 5. The transfer gate, on the connection as it is NOW: the check phase can
  // take a while, and a phone that left Wi-Fi during it must not start
  // downloading on mobile data. The check above ran regardless.
  const settings = useOfflineStore.getState();
  const gate = await transfersAllowed();
  if (!gate.ok) {
    markPins(queue, gate.connected ? "waiting_wifi" : "pending");
    return;
  }

  await withCommit(s, async () => {
    for (const p of new Set(queue.flatMap((f) => byFile.get(f.file_id) ?? []))) await setPinStatus(s, p, "transferring");
  });
  await useOfflineStore.getState().refresh();

  const ctx: TransferCtx = {
    s, denied: new Set(plan.denied), stop: null, active: null,
    retained: await bytesRetained(s),
    budget: settings.budgetBytes,
  };
  run.ctx = ctx;

  // 11. Leaving Wi-Fi (with mobile data off) or losing the connection stops
  // the running download. The saved version is untouched; it was never moved.
  let sub: { remove(): void } | null = null;
  try {
    sub = Network.addNetworkStateListener((e) => {
      const connected = e.isConnected ?? false;
      const wifi = isUnmetered(e.type);
      if (!connected || (!wifi && !useOfflineStore.getState().allowCellular)) {
        ctx.stop = ctx.stop ?? "network";
        void ctx.active?.cancelAsync().catch(() => {});
      }
    });
  } catch {
    // No network events: the pre-transfer check above still applied.
  }

  const total = queue.length;
  const bytesTotal = queue.reduce((n, f) => n + f.size_bytes, 0);
  let done = 0;
  let bytesDone = 0;
  useOfflineStore.getState().setProgress({ done, total, bytesDone, bytesTotal });

  try {
    const byWs = new Map<string, DesiredFile[]>();
    for (const f of queue) {
      const list = byWs.get(f.workspace_id);
      if (list) list.push(f);
      else byWs.set(f.workspace_id, [f]);
    }
    outer: for (const [ws, files] of byWs) {
      for (let i = 0; i < files.length; i += MANIFEST_BATCH) {
        if (ctx.stop || !fence(s)) break outer;
        // And again before each batch: a listener event can be missed.
        if (!(await transfersAllowed()).ok) {
          ctx.stop = "network";
          break outer;
        }
        const batch = files.slice(i, i + MANIFEST_BATCH);
        let links: Map<string, { url: string; size: number }>;
        try {
          const res = await offlineRequest<{ ok: true; downloads?: unknown }>(
            "/api/sync/download-manifest",
            { method: "POST", body: { workspace_id: ws, file_ids: batch.map((f) => f.file_id) } },
          );
          if (!Array.isArray(res.downloads)) throw new ApiError("malformed manifest", 0);
          links = new Map((res.downloads as { fileId: string; url: string; size: number }[]).map((d) => [d.fileId, d]));
        } catch (e) {
          // 6. Never a deletion: the check phase owns denial, and the next
          // run's download-check settles a 403 properly. 429/5xx are errors.
          const forbidden = e instanceof ApiError && e.status === 403;
          markPins(files.slice(i), forbidden ? "update_pending" : "error", false);
          continue outer;
        }
        for (const f of batch) {
          if (ctx.stop || !fence(s)) break outer;
          if (!userAsked && isAutoWorkHeld()) {
            ctx.stop = "heat";
            break outer;
          }
          const link = links.get(f.file_id);
          // Omitted ids (blocked since the check), or a file edited since the
          // check (a different size means different bytes): the next run decides.
          if (!link || link.size !== f.size_bytes) continue;
          await transferOne(ctx, f, link.url);
          done += 1;
          bytesDone += f.size_bytes;
          useOfflineStore.getState().setProgress({ done, total, bytesDone, bytesTotal });
        }
      }
    }
  } finally {
    sub?.remove();
  }

  if (ctx.stop === "network") {
    const left = await readNetwork();
    markPins(queue, left.connected ? "waiting_wifi" : "pending", false);
  } else if (ctx.stop === "heat") {
    markPins(queue, "pending", false);
  } else if (ctx.stop === "no_space" || ctx.stop === "over_budget") {
    markPins(queue, ctx.stop, false);
  }
}

interface TransferCtx {
  s: OfflineSession;
  denied: Set<string>;
  stop: StopReason | null;
  active: CancellableTask | null;
  retained: number;
  budget: number | null;
}

type DownloadOutcome =
  | { kind: "done"; status: number; path: string }
  | { kind: "cancelled"; why: "limit" | "floor" | "stall" | "other" };

/** One download into tmp/, cancelled past `limit` bytes or when free space would cross the floor. */
async function download(ctx: TransferCtx, fileId: string, url: string, limit: number, headers?: Record<string, string>): Promise<DownloadOutcome> {
  // An ended session starts nothing: the purge has already cancelled every
  // task it knew of, and a task created now would write into a wiped root.
  if (!fence(ctx.s)) return { kind: "cancelled", why: "other" };
  const path = tempPath(ctx.s);
  let free = await FileSystem.getFreeDiskStorageAsync();
  let freeAt = 0;
  let probing = false;
  let why: "limit" | "floor" | "stall" | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (why) return;
      why = "stall";
      void task.cancelAsync().catch(() => {});
    }, timeouts.stallMs);
  };
  // Assigned once below; declared first because the progress callback reads it.
  let task: FileSystem.DownloadResumable;
  const onProgress = (p: { totalBytesWritten: number }) => {
    const w = p.totalBytesWritten;
    if (why) return;
    armStall();
    if (w > limit) {
      why = "limit";
      void task.cancelAsync().catch(() => {});
      return;
    }
    if (free - (w - freeAt) < FREE_SPACE_FLOOR_BYTES) {
      why = "floor";
      void task.cancelAsync().catch(() => {});
      return;
    }
    if (!probing && w - freeAt >= FREE_PROBE_BYTES) {
      probing = true;
      const at = w;
      FileSystem.getFreeDiskStorageAsync()
        .then((f) => { free = f; freeAt = at; })
        .catch(() => {})
        .finally(() => { probing = false; });
    }
  };
  task = FileSystem.createDownloadResumable(url, path, headers ? { headers } : {}, onProgress);
  // registerTask cancels at once for an ended session, so a purge that landed
  // between the check above and here still stops this task.
  const unregister = registerTask(fileId, task, ctx.s);
  ctx.active = task;
  armStall();
  try {
    const res = await task.downloadAsync().catch(() => undefined);
    if (!res || why || !fence(ctx.s)) {
      await settleLateWrite(ctx.s, path);
      return { kind: "cancelled", why: why ?? "other" };
    }
    return { kind: "done", status: res.status, path };
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    ctx.active = null;
    unregister();
  }
}

const discard = (p: string | null) => (p ? FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {}) : Promise.resolve());

/**
 * A cancelled or fenced download may still have written: a native downloader
 * can finish its last write after the cancel, and can recreate a directory the
 * purge just removed. Delete the file; if the account has no session at all
 * any more (signed out, not just Remove all), delete its whole root again.
 */
async function settleLateWrite(s: OfflineSession, path: string): Promise<void> {
  const clean = async () => {
    await discard(path);
    if (!fence(s) && currentSession()?.accountId !== s.accountId) await wipeAccount(s.accountId);
  };
  await clean();
  // And once more after a grace period, for the write that lands after the
  // cancel has already returned. Not awaited: nothing waits on a dead task.
  const timer = setTimeout(() => { graceTimers.delete(timer); void clean(); }, timeouts.lateWriteGraceMs);
  graceTimers.add(timer);
}
const graceTimers = new Set<ReturnType<typeof setTimeout>>();

/** The office PDF, polled while the server converts. */
async function fetchRendition(ctx: TransferCtx, fileId: string, reserve: number): Promise<{ path: string; size: number } | "failed" | "skipped" | "cancelled"> {
  let refreshed = false;
  for (let attempt = 0; attempt < MAX_PREVIEW_ATTEMPTS; attempt += 1) {
    // Re-checked before every poll: the conversion can take a minute, and an
    // unpin, a denial or a sign-out in that time ends the wait.
    if (ctx.stop || !fence(ctx.s) || ctx.denied.has(fileId)) return "cancelled";
    if (!(await hasLivePin(ctx.s, fileId).catch(() => false))) return "cancelled";
    const token = getAccessToken();
    const r = await download(ctx, fileId, filePreviewPdfUrl(fileId), reserve, token ? { Authorization: `Bearer ${token}` } : undefined);
    if (r.kind === "cancelled") return r.why === "other" ? "cancelled" : "skipped";
    if (r.status === 200) {
      const info = await FileSystem.getInfoAsync(r.path).catch(() => null);
      const size = info && info.exists && typeof info.size === "number" ? info.size : 0;
      if (size > 0) return { path: r.path, size };
      await discard(r.path);
      return "failed";
    }
    await discard(r.path);
    if (r.status === 503) {
      await sleep(PREVIEW_RETRY_SECONDS * 1000);
      continue;
    }
    if (r.status === 401 && !refreshed) {
      refreshed = true;
      if ((await refreshSession()) === "refreshed") continue;
    }
    return "failed";
  }
  return "failed";
}

async function transferOne(ctx: TransferCtx, f: DesiredFile, url: string): Promise<void> {
  const { s } = ctx;
  const row = await getFileRow(s, f.file_id);
  const oldSaved = row?.saved_version != null ? (row.saved_size ?? 0) : 0;
  const oldRendition = row?.rendition === "ready" ? (row.rendition_size ?? 0) : 0;
  const isOffice = fileKind(f.mime_type, f.extension) === "office";

  // 7. The original alone must fit, both the budget and the free-space floor.
  const free = await FileSystem.getFreeDiskStorageAsync();
  const base = { retained: ctx.retained, oldSaved, oldRendition, newSize: f.size_bytes, budget: ctx.budget };
  if (!fitsBudget({ ...base, newRendition: 0 })) {
    ctx.stop = "over_budget";
    return;
  }
  if (!fitsHeadroom({ free, incoming: f.size_bytes })) {
    ctx.stop = "no_space";
    return;
  }
  // The PDF is optional: if only the reserve does not fit, the original still comes.
  const reserve = RENDITION_RESERVE(f.size_bytes);
  const wantRendition = isOffice
    && fitsBudget({ ...base, newRendition: reserve })
    && fitsHeadroom({ free, incoming: f.size_bytes + reserve });

  // 8. The original, into tmp/.
  const orig = await download(ctx, f.file_id, url, f.size_bytes);
  if (orig.kind === "cancelled") {
    if (orig.why === "floor") ctx.stop = "no_space";
    return;
  }
  if (!fence(s)) {
    await settleLateWrite(s, orig.path);
    return;
  }
  if (orig.status >= 400) {
    // downloadAsync writes an error body to disk as if it were the file.
    await discard(orig.path);
    return;
  }
  let pdfPath: string | null = null;
  try {
    // 10. The PDF, measured for real once it lands.
    let rendition: RenditionState = isOffice ? "skipped" : "none";
    let renditionSize: number | null = null;
    if (wantRendition) {
      const r = await fetchRendition(ctx, f.file_id, reserve);
      if (r === "cancelled") return;
      if (r === "failed") rendition = "failed";
      else if (r === "skipped") rendition = "skipped";
      else {
        const freeNow = await FileSystem.getFreeDiskStorageAsync().catch(() => 0);
        if (fitsBudget({ ...base, newRendition: r.size }) && fitsHeadroom({ free: freeNow, incoming: 0 })) {
          pdfPath = r.path;
          rendition = "ready";
          renditionSize = r.size;
        } else {
          await discard(r.path);
          rendition = "skipped";
        }
      }
    }

    // 9. Publish under the lock, re-checking what may have changed while we
    // downloaded: the session, a live pin, and this run's denials.
    const published = await withCommit(s, async () => {
      if (ctx.denied.has(f.file_id) || !(await getFileRow(s, f.file_id)) || !(await hasLivePin(s, f.file_id))) return false;
      if (!(await verify(orig.path, f.size_bytes))) return false;
      const ext = extOf(f);
      await moveIntoPlace(orig.path, finalPath(s, f.file_id, f.current_version, ext));
      if (pdfPath && !(await verify(pdfPath, renditionSize))) {
        pdfPath = null;
        rendition = "failed";
        renditionSize = null;
      }
      if (pdfPath) await moveIntoPlace(pdfPath, finalPath(s, f.file_id, f.current_version, ext, "pdf"));
      await publishSaved(s, f.file_id, { version: f.current_version, size: f.size_bytes, ext, rendition, renditionSize });
      // The previous version stays on disk for now: a viewer may have it open
      // right this moment. Nothing points at it any more, so the next run's
      // sweep removes it.
      return true;
    });
    if (published) ctx.retained = ctx.retained - oldSaved - oldRendition + f.size_bytes + (renditionSize ?? 0);
  } finally {
    // Whatever was not moved into place - a dropped publish, a fenced session,
    // a cancelled PDF - leaves no temp file behind.
    await discard(orig.path);
    await discard(pdfPath);
  }
}

/**
 * 12. Final statuses: what blocked a pin this run, else ready when every file
 * it covers is saved at the server's version, else update_pending.
 */
async function settleStatuses(s: OfflineSession, blocked: Map<string, PinStatus>): Promise<void> {
  const files = new Map((await listFiles(s)).map((f) => [f.file_id, f]));
  const byPin = new Map<string, string[]>();
  for (const m of await listMembers(s)) {
    const list = byPin.get(m.pin_id);
    if (list) list.push(m.file_id);
    else byPin.set(m.pin_id, [m.file_id]);
  }
  for (const p of await listPins(s)) {
    const b = blocked.get(p.id);
    if (b) {
      await setPinStatus(s, p.id, b, b === "error" ? "check_failed" : null);
      continue;
    }
    if (p.status === "gone") continue;
    const current = (byPin.get(p.id) ?? []).every((id) => {
      const f = files.get(id);
      return !f || (f.saved_version != null && f.saved_version === f.remote_version);
    });
    await setPinStatus(s, p.id, current ? "ready" : "update_pending", null);
  }
}

/** Test hook. */
export function __resetSyncForTests(): void {
  for (const t of graceTimers) clearTimeout(t);
  graceTimers.clear();
  running = null;
  again = false;
  userAsked = false;
  preparedRoots.clear();
}
