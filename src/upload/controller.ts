import * as FileSystem from "expo-file-system/legacy";
import { useUploadStore } from "./store";
import { uploadOne } from "./runner";
import { queryClient } from "@/lib/queryClient";
import { useUploadBlock } from "./uploadBlock";
import { UploadHttpError } from "./uploadError";
import { t } from "@/lib/i18n";
import { getConcurrencyCap, getBackupConcurrencyCap, startPacingMonitor } from "./pacing";


// Server says the workspace is at its concurrent-upload cap → wait and retry,
// with a backoff that doubles up to CAP_BACKOFF_MAX_MULTIPLE times the base
// delay and gives up after CAP_MAX_RETRIES (about 40 minutes in production). It used to retry forever at a flat 5s: a slot that never
// frees (a session the server lost track of, another device holding them all)
// had the phone re-asking every 5s for the rest of the session, on battery.
// The item ends as an error the user can retry, not as a silent hot loop.
const CONCURRENCY_LIMIT_MARKER = "uploads in progress";
const CAP_MAX_RETRIES = 40;
const CAP_BACKOFF_MAX_MULTIPLE = 12;
/**
 * Workspace-wide failures - retrying other files is pointless, so abort the
 * batch. Each marker carries the reason CODE the server's backup_failed
 * notification is built from (spec §5.9, `BACKUP_PAUSE_REASONS` in
 * apps/api/src/lib/notifications/backup.ts).
 *
 * The code is what travels, never the message. The message here is an API
 * error string handed straight through from `ApiError`, and the notification
 * renders {reason} into a push payload and an email body - so the server maps
 * a code of its own choosing and this end never gets to write copy.
 */
const FATAL_MARKERS = [
  ["storage limit", "storage_limit"],
  ["not a member", "not_a_member"],
  ["upload permission", "upload_permission"],
] as const;

export type BackupPauseReasonCode =
  | "storage_limit" | "not_a_member" | "upload_permission" | "other";

/**
 * Which fatal cause a message names, for the server report.
 *
 * `other` is deliberate rather than a failure: a marker added above without a
 * code here, or a fatal path that reaches the block store from somewhere else,
 * still produces a report - one with a vaguer sentence, which is worth far
 * more than no notification at all.
 */
export function fatalReasonCode(msg: string): BackupPauseReasonCode {
  const m = (msg ?? "").toLowerCase();
  return FATAL_MARKERS.find(([marker]) => m.includes(marker))?.[1] ?? "other";
}
// Transient failures - retry a bounded number of times before giving up.
const TRANSIENT_MARKERS = ["network", "nsurlerror", "timed out", "timeout", "connection", "upload failed (5"];
const MAX_TRANSIENT_RETRIES = 3;

let RETRY_DELAY_MS = 5000;
let INVALIDATE_WINDOW_MS = 5000;
let active = 0;
let backoffUntil = 0;
const transientRetries = new Map<string, number>();
const capRetries = new Map<string, number>();

// Test hook: shrink the retry backoff so specs don't wait seconds.
export function __setUploadRetryDelay(ms: number): void {
  RETRY_DELAY_MS = ms;
}

/** How long to wait after the n-th consecutive cap answer for one item:
 * doubling from the base delay, capped at CAP_BACKOFF_MAX_MULTIPLE of it
 * (5s -> 60s in production; scales with the test hook's shorter base). */
export function capBackoffMs(attempt: number, base: number = RETRY_DELAY_MS): number {
  return base * Math.min(2 ** Math.max(0, attempt - 1), CAP_BACKOFF_MAX_MULTIPLE);
}

// Test hook: shrink the invalidation window so specs don't wait seconds.
// Also resets the coalescer so a pending trailing timer from an earlier spec
// (scheduled under the old window) can't swallow the next one.
export function __setInvalidateWindow(ms: number): void {
  INVALIDATE_WINDOW_MS = ms;
  if (invalidateTimer) {
    clearTimeout(invalidateTimer);
    invalidateTimer = null;
  }
  lastInvalidateAt = 0;
}

// Coalesce file-list invalidation. One manual upload still refreshes the list
// instantly, but a backup finishing a photo every couple of seconds must not
// refetch the visible Files list per photo (it read as the list "refreshing"
// constantly, and cost one API request per photo). At most one invalidation
// per window + a trailing one so the final photos always appear.
let lastInvalidateAt = 0;
let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
// Both roots, every time. An uploaded photo lands in the workspace-wide photo
// library as well as in a folder listing, and ["library"] is a separate query
// root - ["files"] does not partial-match it, so invalidating only that left
// the Library tab showing a library the phone had just added to.
function invalidateFileViews(): void {
  queryClient.invalidateQueries({ queryKey: ["files"] });
  queryClient.invalidateQueries({ queryKey: ["library"] });
}
function invalidateFilesCoalesced(): void {
  const now = Date.now();
  if (now - lastInvalidateAt >= INVALIDATE_WINDOW_MS) {
    lastInvalidateAt = now;
    invalidateFileViews();
    return;
  }
  if (!invalidateTimer) {
    invalidateTimer = setTimeout(() => {
      invalidateTimer = null;
      lastInvalidateAt = Date.now();
      invalidateFileViews();
    }, INVALIDATE_WINDOW_MS - (now - lastInvalidateAt));
  }
}

/**
 * Workspace-wide (fatal) upload error - quota / membership / permission.
 * Exposed so the backup orchestrator's large-file loop can halt the run on the
 * same errors that abort the small-file batch here.
 */
export function isFatalUploadError(msg: string): boolean {
  return classifyUploadError(msg) === "fatal";
}

export type ErrorKind = "cap" | "fatal" | "transient" | "hard";
/**
 * Which way a failure goes. The markers match the server's text and the native
 * error text; our own wording is translated, so an HTTP failure of ours is read
 * from its status (UploadHttpError), never from the words.
 */
export function classifyUploadError(msg: string, err?: unknown): ErrorKind {
  const m = msg.toLowerCase();
  if (m.includes(CONCURRENCY_LIMIT_MARKER)) return "cap";
  if (FATAL_MARKERS.some(([f]) => m.includes(f))) return "fatal";
  if (TRANSIENT_MARKERS.some((marker) => m.includes(marker))) return "transient";
  if (err instanceof UploadHttpError && err.status !== null && err.status >= 500) return "transient";
  return "hard";
}

// A workspace-wide error (quota / access): fail every still-queued item
// with the same reason so the run stops instead of erroring hundreds of files.
function abortBatch(reason: string): void {
  useUploadBlock.getState().setReason(reason); // pause auto-backups until a manual retry
  useUploadStore.setState((s) => ({
    items: s.items.map((i) => (i.status === "queued" ? { ...i, status: "error", progress: 0, error: reason } : i)),
  }));
}

// Backup items sit out a policy hold (Wi-Fi-only off Wi-Fi, charging-only off
// the charger); the user's own picks are never held by it.
function nextQueued(includeBackup: boolean) {
  return useUploadStore.getState().items.find(
    (i) => i.status === "queued" && (includeBackup || !i.id.startsWith("bk_")),
  );
}

async function runItem(id: string) {
  const item = useUploadStore.getState().items.find((i) => i.id === id);
  if (!item) { active -= 1; pump(); return; }
  try {
    // Throttle progress writes (~every 2%) so a fast upload doesn't flood the
    // store with re-renders; the dock's own 1s tick keeps speed/ETA moving.
    let lastEmit = 0;
    const { fileId, sizeBytes } = await uploadOne(
      item,
      item.workspaceId,
      (p) => {
        if (p - lastEmit >= 0.02 || p >= 1) {
          lastEmit = p;
          useUploadStore.getState().patch(id, { progress: p });
        }
      },
      // A large file's multipart session lives on the item, so a retry resumes
      // it rather than opening a second one and holding a second slot.
      { onSession: (s) => useUploadStore.getState().patch(id, { resumableSession: s }) },
    );
    transientRetries.delete(id);
    capRetries.delete(id);
    useUploadStore.getState().patch(id, {
      status: "done", progress: 1, fileId, resumableSession: null,
      ...(sizeBytes != null ? { uploadedBytes: sizeBytes } : {}),
    });
    // The extracted Live Photo video was only ever needed to reach the
    // server; once it has, its cache copy is dead weight (a retry re-extracts
    // it rather than needing it).
    const done = useUploadStore.getState().items.find((i) => i.id === id);
    if (done?.pairedTempUri) void FileSystem.deleteAsync(done.pairedTempUri, { idempotent: true }).catch(() => {});
    invalidateFilesCoalesced();
  } catch (e) {
    const msg = e instanceof Error ? e.message : t("common.error.uploadFailed");
    switch (classifyUploadError(msg, e)) {
      case "cap": {
        const n = (capRetries.get(id) ?? 0) + 1;
        if (n <= CAP_MAX_RETRIES) {
          capRetries.set(id, n);
          backoffUntil = Date.now() + capBackoffMs(n);
          useUploadStore.getState().patch(id, { status: "queued", progress: 0, error: undefined });
        } else {
          capRetries.delete(id);
          useUploadStore.getState().patch(id, { status: "error", error: msg });
        }
        break;
      }
      case "fatal":
        transientRetries.delete(id);
        abortBatch(msg);
        useUploadStore.getState().patch(id, { status: "error", error: msg });
        break;
      case "transient": {
        const n = (transientRetries.get(id) ?? 0) + 1;
        if (n <= MAX_TRANSIENT_RETRIES) {
          transientRetries.set(id, n);
          backoffUntil = Date.now() + RETRY_DELAY_MS;
          useUploadStore.getState().patch(id, { status: "queued", progress: 0, error: undefined });
        } else {
          transientRetries.delete(id);
          useUploadStore.getState().patch(id, { status: "error", error: msg });
        }
        break;
      }
      default:
        transientRetries.delete(id);
        useUploadStore.getState().patch(id, { status: "error", error: msg });
    }
  } finally {
    active -= 1;
    pump();
  }
}

function pump() {
  const now = Date.now();
  if (now < backoffUntil) {
    setTimeout(pump, backoffUntil - now);
    return;
  }
  // Cap is dynamic: thermal/battery pacing can shrink it to 1 or pause at 0,
  // and a network/charger policy hold parks backup items at 0 on their own.
  while (active < getConcurrencyCap()) {
    const next = nextQueued(getBackupConcurrencyCap() > 0);
    if (!next) break;
    active += 1;
    if (useUploadStore.getState().batchStartedAt == null) {
      useUploadStore.getState().setBatchStartedAt(Date.now());
    }
    useUploadStore.getState().patch(next.id, { status: "uploading", progress: 0, error: undefined });
    void runItem(next.id);
  }
  if (active === 0 && !useUploadStore.getState().items.some((i) => i.status === "uploading" || i.status === "queued")) {
    useUploadStore.getState().setBatchStartedAt(null);
  }
}

export function startUploads(): void {
  // Idempotent: watches thermal + charging and re-kicks the pump when the cap
  // rises again (auto-resume after a thermal pause).
  startPacingMonitor(pump);
  pump();
}

export function retryItem(id: string): void {
  transientRetries.delete(id);
  capRetries.delete(id);
  useUploadStore.getState().patch(id, { status: "queued", error: undefined, progress: 0 });
  pump();
}

// There is no `retryAll` any more. It existed for UploadDock's footer button;
// the orbit sheet retries one row at a time, so a bulk version had no caller
// and nothing cleared `transientRetries` / `capRetries` wholesale.
