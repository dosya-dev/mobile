import * as FileSystem from "expo-file-system/legacy";
import { useUploadStore } from "./store";
import { errorFields } from "./uploadError";
import { startUploads } from "./controller";
import { noteUploadIds } from "./pickers";
import type { UploadItem } from "./types";

/**
 * The manual upload queue, on disk.
 *
 * The store is in-memory, so until now an upload the user queued and then
 * backgrounded away from was simply gone after the OS killed the app - with
 * nothing in the UI to say so. The share-sheet path had been described as
 * "persisted and retried after a restart" for a while; this is what makes
 * that sentence true.
 *
 * Only the user's own items are written. Backup (`bk_`) items are derived from
 * the ledger by the orchestrator on every run and carry per-process completion
 * bookkeeping (see backup/completion.ts), so restoring them would only produce
 * duplicates. `done` items are not written either - they are history, and the
 * dock already lets the user clear them.
 *
 * A JSON file under the document directory (not the cache, which the OS may
 * purge), same shape as the byte store's own index. Every read here resolves
 * rather than rejects: a missing or corrupt file is an empty queue.
 */

export const UPLOAD_QUEUE_FILE = `${FileSystem.documentDirectory ?? ""}upload-queue.json`;

const PERSIST_DEBOUNCE_MS = 500;
// Functions: the words are produced when the row is restored, in the language chosen then.
const errorStagedFileGone = () => errorFields("upload.error.fileIsNoLongerOnThisDevice");
const errorInterrupted = () => errorFields("upload.label.interruptedTapToRetry");

interface PersistedQueue {
  v: 1;
  items: UploadItem[];
}

function isPersisted(item: UploadItem): boolean {
  return !item.id.startsWith("bk_") && item.status !== "done";
}

/** The subset of an item that is a fact about the file rather than about this process. */
function toRecord(item: UploadItem): UploadItem {
  return {
    id: item.id,
    name: item.name,
    uri: item.uri,
    size: item.size,
    mime: item.mime,
    folderId: item.folderId,
    workspaceId: item.workspaceId,
    status: item.status,
    // Bytes on the wire do not survive the process; the transfer restarts.
    progress: 0,
    ...(item.error !== undefined ? { error: item.error } : {}),
    ...(item.errorMessage ? { errorMessage: item.errorMessage } : {}),
    ...(item.versionOfFileId !== undefined ? { versionOfFileId: item.versionOfFileId } : {}),
    ...(item.sourceCreatedAt !== undefined ? { sourceCreatedAt: item.sourceCreatedAt } : {}),
    ...(item.sourceModifiedAt !== undefined ? { sourceModifiedAt: item.sourceModifiedAt } : {}),
    // A fact about the server, not about this process: resuming a part-uploaded
    // video after a relaunch is the whole point of keeping it.
    ...(item.resumableSession ? { resumableSession: item.resumableSession } : {}),
  };
}

function serialize(items: UploadItem[]): string {
  const q: PersistedQueue = { v: 1, items: items.filter(isPersisted).map(toRecord) };
  return JSON.stringify(q);
}

let lastWritten: string | null = null;

/** Write the current queue. Best-effort; a failed write leaves the last good file. */
export async function persistUploadQueue(items: UploadItem[] = useUploadStore.getState().items): Promise<void> {
  const next = serialize(items);
  if (next === lastWritten) return;
  try {
    await FileSystem.writeAsStringAsync(UPLOAD_QUEUE_FILE, next);
    lastWritten = next;
  } catch {
    /* storage unavailable - the in-memory queue still holds for this session */
  }
}

async function readPersistedUploads(): Promise<UploadItem[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(UPLOAD_QUEUE_FILE);
    const parsed = JSON.parse(raw) as Partial<PersistedQueue> | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(
      (i): i is UploadItem => !!i && typeof i.id === "string" && typeof i.uri === "string" && typeof i.workspaceId === "string",
    );
  } catch {
    // Missing or corrupt: an empty queue, never an error the launch path has
    // to handle.
    return [];
  }
}

async function stagedFileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info && info.exists === true && !info.isDirectory;
  } catch {
    return false;
  }
}

let hydrateP: Promise<Set<string>> | null = null;

/**
 * Restore the persisted queue into the store and start it moving again.
 *
 * Items that were queued or mid-flight go back to `queued` - the transfer is
 * gone, the file is not - and the pump is kicked. An item whose staged file has
 * meanwhile disappeared (the OS purged the cache, the picker's copy expired)
 * becomes an `error` row that says so, rather than an upload that fails every
 * launch with a message about a path.
 *
 * Returns the uris the restored items still point at, so the launch-time cache
 * sweep can leave those staged copies alone. Once per process; never rejects.
 */
export function hydrateUploadQueue(): Promise<Set<string>> {
  if (!hydrateP) {
    hydrateP = (async () => {
      const kept = new Set<string>();
      try {
        const saved = await readPersistedUploads();
        if (saved.length === 0) return kept;
        const present = new Set(useUploadStore.getState().items.map((i) => i.id));
        const restored: UploadItem[] = [];
        for (const item of saved) {
          if (present.has(item.id)) continue;
          if (item.status === "error") {
            restored.push({ ...item, progress: 0 });
            kept.add(item.uri);
            continue;
          }
          const staged = await stagedFileExists(item.uri);
          if (!staged) {
            restored.push({ ...item, status: "error", progress: 0, ...errorStagedFileGone() });
            continue;
          }
          if (item.status === "uploading") {
            // An `uploading` row is NOT safe to re-queue. The file was on the
            // wire when the process died, and the write below it is debounced -
            // so the transfer may well have COMPLETED server-side, and starting
            // it again would put a second copy in the workspace under the user's
            // nose. Offer it instead: an error row the dock can retry with one
            // tap, where a duplicate is the user's choice rather than ours.
            restored.push({ ...item, status: "error", progress: 0, ...errorInterrupted() });
            kept.add(item.uri);
            continue;
          }
          restored.push({ ...item, status: "queued", progress: 0, error: undefined });
          kept.add(item.uri);
        }
        if (restored.length === 0) return kept;
        // Ids are minted from a per-process counter; a restored id must never
        // be minted again for a new pick, or two rows share one progress bar.
        noteUploadIds(restored.map((i) => i.id));
        useUploadStore.getState().enqueue(restored);
        // Deliberately NOT pumped here. This runs at launch, which happens
        // signed out too (a dead session, a locked keychain) - and an upload
        // fired then just fails on a missing token and burns the retry budget.
        // The signed-in tree calls resumeUploadQueue instead.
      } catch {
        /* anything unexpected: an empty restore, the app launches as before */
      }
      return kept;
    })();
  }
  return hydrateP;
}

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start sending whatever the restore put back. Called once there IS a session;
 * a no-op when nothing is queued, so it is safe to call on every sign-in.
 */
export function resumeUploadQueue(): void {
  if (!useUploadStore.getState().items.some((i) => i.status === "queued")) return;
  startUploads();
}

/**
 * Keep the file in step with the store for the life of the process. Debounced,
 * because a backup run patches progress many times a second and none of those
 * writes change what gets persisted. Idempotent.
 */
export function startUploadQueuePersistence(): void {
  if (unsubscribe) return;
  unsubscribe = useUploadStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persistUploadQueue(state.items);
    }, PERSIST_DEBOUNCE_MS);
  });
}

/** Account purge (sign-out): the queue belongs to the account that is leaving. */
export async function clearPersistedUploads(): Promise<void> {
  lastWritten = null;
  try {
    await FileSystem.deleteAsync(UPLOAD_QUEUE_FILE, { idempotent: true });
  } catch {
    /* nothing persisted, or not deletable */
  }
}

// Test hook: simulate a fresh process.
export function __resetUploadQueuePersistence(): void {
  hydrateP = null;
  lastWritten = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
