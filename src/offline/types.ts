/**
 * "Available offline": a pin is a file or folder the user asked us to keep on
 * the phone. The plan is docs/superpowers/plans/2026-11-04-mobile-offline-files.md;
 * its "Membership vs access" tables are the rules everything here follows.
 */

export type PinKind = "file" | "folder";

export type PinStatus =
  | "pending" | "checking" | "transferring" | "ready" | "update_pending"
  | "waiting_wifi" | "no_space" | "over_budget" | "error" | "gone";

export interface PinRow {
  /** The pinned file's or folder's own id. */
  id: string;
  kind: PinKind;
  workspace_id: string;
  name: string;
  created_at: number;
  /**
   * Bumped on every pin and re-pin, and never reused: an unpin records the last
   * value so a later re-pin starts above it. A check result carries the value
   * it began with, and apply ignores it if the pin has moved on since - so an
   * unpin or re-pin during a check cannot be undone by that check's results.
   */
  revision: number;
  status: PinStatus;
  last_checked_at: number | null;
  last_error: string | null;
}

export type RenditionState = "none" | "ready" | "failed" | "skipped";

/** A file some pin covers. `saved_*` describe the bytes on the phone, `remote_*` the server's. */
export interface OfflineFileRow {
  file_id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  extension: string | null;
  mime_type: string;
  size_bytes: number;
  remote_version: number;
  /** Null until a version has been downloaded and published. */
  saved_version: number | null;
  saved_size: number | null;
  /** The office PDF conversion; only meaningful for office files. */
  rendition: RenditionState;
  rendition_version: number | null;
  rendition_size: number | null;
  updated_at: number;
  /**
   * The extension the saved bytes were written under, fixed at publish. Null
   * for a row saved before it was recorded (then the metadata extension is
   * used, as it was). Optional so rows built by hand in tests need not set it.
   */
  saved_ext?: string | null;
}

/** One pin covering one file. Two consecutive misses in a complete snapshot drop it. */
export interface PinMember {
  pin_id: string;
  file_id: string;
  missing_count: number;
}

/** A folder inside a pinned folder (or the pinned folder itself), for offline browsing. */
export interface OfflineFolderRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  pin_id: string;
}

/** A file as the server describes it in this run's check. */
export interface DesiredFile {
  file_id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  extension: string | null;
  mime_type: string;
  size_bytes: number;
  current_version: number;
  updated_at: number;
  /**
   * Straight from the server. Only "full_lock" / "view_only" mean denied; an
   * empty string (an old cached response without the field) keeps the saved
   * copy but starts no transfer.
   */
  lock_mode: string;
}
