import { t } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { fixedNumber, localDigits } from "@/lib/format-locale";

/** The API's floor. Enforced here too, so a short password fails before the send. */
export const MIN_REQUEST_PASSWORD = 8;

const MB = 1024 * 1024;

export interface RequestRow {
  id: string;
  token: string;
  title: string | null;
  message: string | null;
  is_password_protected: number;
  expires_at: number | null;
  allowed_extensions: string | null;
  max_file_size_bytes: number | null;
  max_files: number | null;
  upload_count: number;
  is_revoked: number;
  created_at: number;
  folder_id: string | null;
  created_by_name: string | null;
  folder_name: string | null;
  url: string;
}

export interface RecipientRow {
  id: string;
  email: string;
  token: string;
  sent_at: number | null;
  uploaded_at: number | null;
  created_at: number;
}

export type RequestStatus = "closed" | "expired" | "full" | "active";

/**
 * Why a request is or is not accepting uploads.
 *
 * Ordered deliberately. Closed outranks expired because closing it was the
 * deliberate act and the elapsed expiry is incidental. `full` is a state of its
 * own rather than folded into active: at max_files the request refuses the next
 * upload, and a card reading "Active" would be a lie the uploader discovers and
 * the owner never does.
 */
export function requestStatus(r: RequestRow, now: number): RequestStatus {
  if (r.is_revoked === 1) return "closed";
  if (r.expires_at !== null && r.expires_at < now) return "expired";
  if (r.max_files !== null && r.upload_count >= r.max_files) return "full";
  return "active";
}

/** Keys, not text: the label is produced at render so a language switch reaches it. */
const STATUS_KEYS: Record<RequestStatus, MessageKey> = {
  closed: "file-requests.status.closed",
  expired: "common.status.expired",
  full: "file-requests.status.full",
  active: "file-requests.status.active",
};

export function statusLabel(s: RequestStatus): string {
  return t(STATUS_KEYS[s]);
}

/** Whole MB where it divides evenly - the API takes the cap in MB to begin with. */
function sizeCap(bytes: number): string {
  const mb = bytes / MB;
  return t("file-requests.label.valueMB", { value: Number.isInteger(mb) ? localDigits(mb) : fixedNumber(mb, 1) });
}

/** One line naming every limit on a request, or null when it has none. */
export function describeLimits(r: RequestRow): string | null {
  const exts = r.allowed_extensions
    ? r.allowed_extensions.split(",").map((e) => e.trim().replace(/^\./, "")).filter(Boolean)
    : [];
  const hasSize = r.max_file_size_bytes !== null;
  const hasMaxFiles = r.max_files !== null;
  const hasExtensions = exts.length > 0;
  if (!hasSize && !hasMaxFiles && !hasExtensions) return null;
  // One message per language: the parts and their separators are decided by
  // the selects, so no language has to glue English fragments together.
  return t("file-requests.description.hassize", {
    hasSize: String(hasSize),
    hasMaxFiles: String(hasMaxFiles),
    hasExtensions: String(hasExtensions),
    size: hasSize ? sizeCap(r.max_file_size_bytes as number) : "",
    count: r.max_files ?? 0,
    extensions: exts.join(", "),
  });
}

/** The message to show, or null when the password is acceptable. Empty is fine - it is optional. */
export function validatePassword(pw: string): string | null {
  if (!pw) return null;
  return pw.length < MIN_REQUEST_PASSWORD
    ? t("file-requests.label.useAtLeastMinRequestPasswordCharacters", { minRequestPassword: localDigits(MIN_REQUEST_PASSWORD) })
    : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Addresses out of whatever was typed or pasted.
 *
 * Accepts a pasted list because people paste lists, and a phone keyboard makes
 * that more likely rather than less. Invalid entries are dropped rather than
 * failing the whole paste - the chips then show exactly who will be invited.
 */
export function parseEmails(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[,;\s]+/)) {
    const email = raw.trim().toLowerCase();
    if (email && EMAIL.test(email)) seen.add(email);
  }
  return [...seen];
}

export function recipientState(r: RecipientRow): "uploaded" | "invited" | "pending" {
  if (r.uploaded_at !== null) return "uploaded";
  return r.sent_at !== null ? "invited" : "pending";
}

/**
 * Where uploads land.
 *
 * The listing LEFT JOINs folders on `is_deleted = 0`, so a request pointed at a
 * since-deleted folder returns an id with a null name. That is worth naming
 * rather than printing an empty string or pretending it is the root.
 */
export function destinationLabel(r: RequestRow): string {
  if (!r.folder_id) return t("common.label.workspaceRoot");
  return r.folder_name ?? t("file-requests.label.unknownFolder");
}
