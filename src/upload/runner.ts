import * as FileSystem from "expo-file-system/legacy";
import { getItem, setItem } from "@/lib/keychain";
import { apiRequest, API_BASE_URL } from "@/api";
import { getAccessToken, refreshSession } from "@/auth/authStore";
import type { UploadItem } from "./types";
import { sourceTimeHeaders } from "./sourceTime";
import { uploadResumable, type ResumableSession } from "./resumable";
import { UploadHttpError } from "./uploadError";
import { t } from "@/lib/i18n";

interface InitResponse {
  ok: true;
  session_id: string;
  upload_url: string;
  /**
   * Present for any file over the server's multipart threshold (50 MB, see
   * apps/api/src/pages/api/upload/init.ts). The three URLs were always in the
   * response; this client simply used to drop them and give up.
   */
  resumable?: {
    part_size: number;
    total_parts: number;
    part_upload_url?: string;
    complete_url?: string;
    status_url?: string;
  } | null;
}

// Whether THIS device's NSURLSession can read Photos-library file:// paths
// directly. "direct" halves per-photo disk I/O (no cache copy); "copy" is the
// safe fallback for devices where direct reads fail (NSURLErrorDomain -1).
// Learned once from a real upload, then persisted.
const DIRECT_CAPABILITY_KEY = "dosya.upload.directCapability";
let directCapability: "unknown" | "direct" | "copy" = "unknown";
let capabilityLoaded = false;

async function loadDirectCapability(): Promise<void> {
  if (capabilityLoaded) return;
  capabilityLoaded = true;
  try {
    const v = await getItem(DIRECT_CAPABILITY_KEY);
    if (v === "direct" || v === "copy") directCapability = v;
  } catch {
    /* stays unknown - decided by the next upload */
  }
}

function persistDirectCapability(v: "direct" | "copy"): void {
  directCapability = v;
  try {
    void setItem(DIRECT_CAPABILITY_KEY, v).catch(() => {});
  } catch {
    /* best-effort */
  }
}

// The signature of "the file could not be READ from its source" - distinct
// from network failures, which must NOT flip the device to copy mode.
const READ_FAILURE = /NSURLErrorDomain.{0,24}-1(\D|$)|couldn.?t be (read|opened)|no permission|does not exist/i;

// Test hook.
export function __resetDirectCapability(): void {
  directCapability = "unknown";
  capabilityLoaded = false;
}

export interface UploadResult {
  fileId: string;
  /** Bytes the server reports having stored, or null when the response had no count. */
  sizeBytes: number | null;
}

export async function uploadOne(
  item: UploadItem,
  workspaceId: string,
  onProgress: (p: number) => void,
  opts?: {
    /**
     * Called with a multipart session to store on the item, or null to drop
     * one that turned out to be dead. The caller owns the queue, so it is the
     * only thing that can make a session outlive this call.
     */
    onSession?: (s: ResumableSession | null) => void;
  },
): Promise<UploadResult> {
  // A stored session means this is a retry of a large file. Resume it and skip
  // init entirely - a second init would orphan the session this one belongs to.
  const stored = item.resumableSession;
  if (stored) {
    try {
      const fileId = await uploadResumable(item, workspaceId, onProgress, { savedSession: stored });
      return { fileId, sizeBytes: null };
    } catch (e) {
      // The server sweeps abandoned sessions, so a stored one can be dead by
      // the time a retry reaches it - and retrying it forever would never
      // recover. Drop it; the next attempt starts a fresh upload.
      opts?.onSession?.(null);
      throw e;
    }
  }

  // init runs through the API client (auto-refreshes the access token).
  const init = await apiRequest<InitResponse>("/api/upload/init", {
    method: "POST",
    body: {
      workspace_id: workspaceId,
      file_name: item.name,
      file_size: item.size,
      mime_type: item.mime,
      folder_id: item.folderId,
      ...(item.versionOfFileId ? { file_id: item.versionOfFileId } : {}),
    },
  });

  // Over the server's multipart threshold. This used to throw "Large files
  // (over 50 MB) aren't supported for mobile upload yet." while a complete
  // resumable uploader sat in the same folder, used only by photo backup.
  if (init.resumable) {
    const { part_upload_url, complete_url, status_url, part_size } = init.resumable;
    if (!part_upload_url || !complete_url || !status_url) {
      // Better a clear refusal than parts PUT at "undefined/1".
      throw new Error(t("common.error.theServerOfferedAResumableUploadWithoutPartURLs"));
    }
    // Hand over THIS session rather than letting uploadResumable open its own.
    // A second init orphans the one above, and every session holds a workspace
    // concurrency slot until the server reclaims it - so a few retries of one
    // big video could lock the account out of transfers entirely.
    const session: ResumableSession = {
      sessionId: init.session_id,
      partSize: part_size,
      partUploadUrl: part_upload_url,
      completeUrl: complete_url,
      statusUrl: status_url,
    };
    // Stored BEFORE any part goes up, so a failure half way through resumes
    // rather than opening a second session next time.
    opts?.onSession?.(session);
    const fileId = await uploadResumable(item, workspaceId, onProgress, { savedSession: session });
    // The multipart completion response carries no measured byte count, so
    // there is nothing to hand the backup truncation check here.
    return { fileId, sizeBytes: null };
  }

  const url = `${API_BASE_URL}${init.upload_url}`;

  // The native upload task (NSURLSession) can't reliably read a source outside
  // our sandbox - e.g. an iOS Photos-library file:// path from a backup - which
  // surfaces as `NSURLErrorDomain -1`. Copy it into our own cache first (the
  // same thing the image picker does), upload that, then clean up. Best-effort:
  // fall back to the original uri if the copy fails.
  const cachePath = `${FileSystem.cacheDirectory}upload-${item.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
  let src = item.uri;
  let copied = false;
  // Only sources OUTSIDE our sandbox (e.g. an iOS Photos-library path) may need
  // the cache-copy treatment. Picker / backup-cache uris are already readable.
  const inSandbox =
    (!!FileSystem.cacheDirectory && item.uri.startsWith(FileSystem.cacheDirectory)) ||
    (!!FileSystem.documentDirectory && item.uri.startsWith(FileSystem.documentDirectory));

  const copyToCache = async () => {
    await FileSystem.copyAsync({ from: item.uri, to: cachePath });
    src = cachePath;
    copied = true;
  };
  if (!inSandbox) {
    await loadDirectCapability();
    if (directCapability === "copy") {
      try {
        await copyToCache();
      } catch {
        /* keep the original uri - the upload attempt decides */
      }
    }
  }
  const cleanup = () => {
    if (copied) void FileSystem.deleteAsync(cachePath, { idempotent: true }).catch(() => {});
  };

  // Read the token PER ATTEMPT, never once up front. The access token lives 1
  // hour; a backup routinely runs longer, so a value captured before the first
  // file is already dead by the time the queue reaches the last one - and the
  // native upload task can't use apiRequest's transparent 401 retry.
  const runUpload = async () => {
    // Stat the source right before handing it to the native task. expo's
    // `createUploadTask` has no exists check (`uploadAsync` does), its session
    // is a BACKGROUND NSURLSession, and that session throws an uncatchable
    // NSInvalidArgumentException ("Cannot read file at <path>") when the
    // source cannot be opened - which took the whole process down at 01:47
    // one night when a staged copy had been swept under a locked device.
    // A missing file is this item's failure, never the process's.
    //
    // Only for sources inside our own sandbox (the staged and cached copies,
    // which is where the crash came from): a stat on a Photos-library path is
    // not something to trust, and a direct read that fails there already has
    // its copy-and-retry fallback below.
    const srcInSandbox =
      (!!FileSystem.cacheDirectory && src.startsWith(FileSystem.cacheDirectory)) ||
      (!!FileSystem.documentDirectory && src.startsWith(FileSystem.documentDirectory));
    if (srcInSandbox) {
      const info = await FileSystem.getInfoAsync(src).catch(() => null);
      if (info && !info.exists) {
        throw new Error(t("common.error.sourceFileIsMissingOnThisDeviceSrcSlice", { slice: src.slice(0, 16) }));
      }
    }
    const token = getAccessToken();
    const task = FileSystem.createUploadTask(
      url,
      src,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          "Content-Type": item.mime,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...sourceTimeHeaders(item),
        },
      },
      (p) => {
        if (p.totalBytesExpectedToSend > 0) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend);
      },
    );
    return task.uploadAsync();
  };

  let res;
  try {
    res = await runUpload();
    // A successful DIRECT read from outside the sandbox proves the fast path.
    if (!inSandbox && !copied && directCapability === "unknown") persistDirectCapability("direct");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // Direct read failed on a Photos-library path: remember that this device
    // needs copies, make the copy, and retry ONCE. Network errors rethrow -
    // they must not flip the device into permanent copy mode.
    if (!inSandbox && !copied && READ_FAILURE.test(detail)) {
      persistDirectCapability("copy");
      try {
        await copyToCache();
        res = await runUpload();
      } catch (e2) {
        cleanup();
        const d2 = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(t("common.label.d2TargetUrlSrcSliceAfterCopyFallback", { d2, url, slice: src.slice(0, 16) }));
      }
    } else {
      cleanup();
      // Keep the native message (e.g. NSURLErrorDomain codes) + resolved source.
      throw new Error(t("common.label.detailTargetUrlSrcSlice", { detail, url, slice: src.slice(0, 16) }));
    }
  }
  // A 401 here is almost always the 1-hour access token expiring mid-backup, not
  // a dead session (the refresh token is good for 60 days). apiRequest retries
  // these transparently; the native upload task has to do it by hand. Retry ONCE
  // and only when the refresh actually produced a new token.
  if (res && res.status === 401) {
    const outcome = await refreshSession();
    if (outcome === "refreshed") {
      try {
        res = await runUpload();
      } catch (e) {
        cleanup();
        const d = e instanceof Error ? e.message : String(e);
        throw new Error(t("common.label.dTargetUrlAfterTokenRefresh", { d, url }));
      }
    }
  }

  cleanup();

  if (!res || res.status >= 400) {
    const fallback = t("common.error.uploadFailedStatus", { status: String(res?.status ?? "?") });
    let msg = fallback;
    try { msg = JSON.parse(res!.body).error ?? msg; } catch { /* keep default */ }
    // The status travels only with our own wording: the server's text is classified by what it says.
    throw new UploadHttpError(msg, msg === fallback ? res?.status ?? null : null);
  }

  let fileId = "";
  let sizeBytes: number | null = null;
  try {
    const file = JSON.parse(res.body).file ?? {};
    fileId = file.id ?? "";
    // The server measures what actually landed in storage. Handed back so the
    // backup completion handler can compare it with the local size.
    sizeBytes = typeof file.size_bytes === "number" && Number.isFinite(file.size_bytes) ? file.size_bytes : null;
  } catch { /* ignore */ }
  return { fileId, sizeBytes };
}

/**
 * Delete orphaned `upload-*` temp copies left in the cache by an upload that was
 * killed mid-flight (cleanup normally runs on success + failure, but not on a
 * process kill). Call once at app start so the cache can't slowly grow.
 *
 * `keep` names staged copies the persisted upload queue still points at (see
 * upload/persist.ts) - the share sheet stages into this same prefix, and a
 * queued share must survive the relaunch that this sweep runs on.
 */
export async function sweepUploadCache(keep: ReadonlySet<string> = new Set()): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    const names = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      names
        .filter((n) => n.startsWith("upload-") && !keep.has(dir + n))
        .map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {})),
    );
  } catch {
    /* best-effort */
  }
}
