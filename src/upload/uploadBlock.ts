import { create } from "zustand";
import { getItem, setItem, deleteItem } from "@/lib/keychain";
import en from "@/i18n/messages/en.json";
import { makeT, type Messages, type T } from "@/i18n/translator";
import type { MessageKey } from "@/i18n/keys";

export const UPLOAD_BLOCK_KEY = "dosya.upload.block";

/**
 * A reason the app wrote itself: a catalog key and its values, shown in the
 * language chosen when it is read, not the language at the moment it was set.
 * `text` is the English sentence of the same message and is what `reason`
 * holds, so `reason` stays a stable string for logs, the server report and
 * truthiness checks.
 */
export interface BlockMessage {
  key: MessageKey;
  values?: Record<string, string | number>;
  text: string;
}

const english = makeT("en", en as Messages, en as Messages);

interface UploadBlockState {
  // Set when uploads fail with a workspace-wide (fatal) error such as a storage
  // quota. Pauses AUTO backups (background task + media-change listener) until a
  // manual retry clears it, so we don't hammer the server re-uploading the same
  // failing files every run.
  reason: string | null;
  /** Set when the reason is one of our own catalog messages; null for server or native text. */
  message: BlockMessage | null;
  setReason: (r: string | null) => void;
  /** Block with one of our own catalog messages (shown in the reader's language). */
  setReasonMessage: (key: MessageKey, values?: Record<string, string | number>) => void;
}

/** The block's reason as the screen shows it, in the language chosen now. */
export function blockReasonText(s: { reason: string | null; message: BlockMessage | null }, t: T): string | null {
  if (!s.reason) return null;
  // A message only counts while it still describes the reason (a test or a
  // restore can replace `reason` alone).
  return s.message && s.message.text === s.reason ? t(s.message.key, s.message.values) : s.reason;
}

// Fire-and-forget persistence: the in-memory value is already correct for this
// session; the stored copy only matters for the next app launch. Guarded so a
// missing native store (e.g. bare jest env) can never break setReason.
function persist(reason: string | null, message: BlockMessage | null = null): void {
  try {
    void (reason == null
      ? deleteItem(UPLOAD_BLOCK_KEY)
      : setItem(UPLOAD_BLOCK_KEY, message ? JSON.stringify({ block: message }) : reason)
    ).catch(() => {});
  } catch {
    /* storage unavailable - in-memory block still holds for this session */
  }
}

export const useUploadBlock = create<UploadBlockState>((set) => ({
  reason: null,
  message: null,
  setReason: (reason) => {
    set({ reason, message: null });
    persist(reason);
  },
  setReasonMessage: (key, values) => {
    const message: BlockMessage = { key, values, text: english(key, values) };
    set({ reason: message.text, message });
    persist(message.text, message);
  },
}));

/** A persisted block: plain text (older builds, server text) or a stored catalog message. */
function parseStored(stored: string): { reason: string; message: BlockMessage | null } {
  if (stored.startsWith("{")) {
    try {
      const m = (JSON.parse(stored) as { block?: BlockMessage }).block;
      if (m && typeof m.key === "string" && typeof m.text === "string") return { reason: m.text, message: m };
    } catch {
      /* not ours: plain text */
    }
  }
  return { reason: stored, message: null };
}

let hydrateP: Promise<void> | null = null;

/**
 * True while `hydrateUploadBlock` is writing a RESTORED reason into the store.
 *
 * Subscribers see a null → reason transition either way, and the two are not
 * the same event: one is a backup that has just stopped, the other is an app
 * remembering that it stopped some time ago. Reading the flag rather than
 * comparing timestamps works because zustand calls subscribers synchronously
 * inside `setState`, so it is still true when they run.
 *
 * Without this, `startBackupAlerts` raised a fresh "Backup paused" alert on
 * every single launch while a block was in force - and, once the pause is also
 * reported to the server, would have posted a notification each time too.
 */
let restoring = false;
export function isRestoringBlock(): boolean {
  return restoring;
}

/**
 * Restore a persisted block once per process, so a fatal pause (e.g. storage
 * limit) survives an app restart - without it the hourly background task would
 * retry, fail, and re-block on every launch. Never clobbers a reason already
 * set in this session; safe to call from anywhere (idempotent, cached).
 */
export function hydrateUploadBlock(): Promise<void> {
  if (!hydrateP) {
    hydrateP = (async () => {
      try {
        const stored = await getItem(UPLOAD_BLOCK_KEY);
        if (stored && useUploadBlock.getState().reason == null) {
          restoring = true;
          try {
            useUploadBlock.setState(parseStored(stored));
          } finally {
            restoring = false;
          }
        }
      } catch {
        /* storage unavailable - treat as no persisted block */
      }
    })();
  }
  return hydrateP;
}

// Test hook: lets specs simulate a fresh process.
export function __resetUploadBlockHydration(): void {
  hydrateP = null;
  restoring = false;
}
