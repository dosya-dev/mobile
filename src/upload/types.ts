export type UploadStatus = "queued" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  uri: string;
  size: number;
  mime: string;
  folderId: string | null;
  workspaceId: string;
  status: UploadStatus;
  progress: number; // 0..1
  error?: string;
  /**
   * Set when `error` is one of our own catalog messages: the key and values, so
   * the row reads in the language chosen when it is shown (`error` then holds
   * the English sentence of the same message). Absent for server and native text.
   */
  errorMessage?: { key: import("@/i18n/keys").MessageKey; values?: Record<string, string | number> };
  /** OUTPUT: the id of the file the server created, filled in once the upload finishes. */
  fileId?: string;
  /**
   * OUTPUT: how many bytes the server says it stored (`file.size_bytes` in the
   * upload response), so a completion handler can compare it with `size` and
   * refuse to call a short or truncated transfer a backup. Absent when the
   * response carried no count.
   */
  uploadedBytes?: number;
  /**
   * INPUT: upload these bytes as a new VERSION of this existing file rather
   * than as a new file. /api/upload/init has accepted a `file_id` for this all
   * along; mobile simply never sent one. The server refuses it for a locked
   * file, so callers must gate on lock_mode before offering the save.
   */
  versionOfFileId?: string;
  /**
   * INPUT: the file's original dates (unix seconds), declared to the server
   * via the X-Dosya-Source-* headers so a backed-up photo lists under the day
   * it was taken, not the day the backup ran. New files only server-side.
   */
  sourceCreatedAt?: number;
  sourceModifiedAt?: number;
  /**
   * IN/OUT: the server-side multipart session for a file over the upload
   * threshold, stored so a retry RESUMES it rather than starting again.
   *
   * Re-initing is not merely wasteful: every session holds a workspace
   * concurrency slot until the server reclaims it 15 minutes later, so a few
   * retries of one big video could refuse every other transfer on the account.
   */
  resumableSession?: import("./resumable").ResumableSession | null;
  /**
   * INPUT: a Live Photo video extracted into the cache for this upload. Deleted
   * once the upload is done; a retry re-extracts rather than needing it.
   */
  pairedTempUri?: string;
}
