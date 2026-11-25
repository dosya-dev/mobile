export interface ShareLink {
  id: string;
  token: string;
  url: string;
  is_password_protected?: number;
  expires_at?: number | null;
  view_count?: number;
}

/** How long a link has left to live, as the API computes it. */
export type ShareStatus = "active" | "expiring" | "expired" | "revoked";

/** What the link refuses to serve: nothing, downloads, or everything without a password. */
export type ShareLockMode = "none" | "view_only" | "full_lock";

/** Bearer ("anyone with the link") vs a named recipient list. */
export type ShareAccessMode = "public" | "restricted";

/**
 * One row of GET /api/shares.
 *
 * Every field here is one the endpoint already returns. The previous shape
 * declared nine of them and the list screen showed five, so a link's whole
 * security posture - protected, view-only, restricted to N people - arrived on
 * the device every time and was thrown away before it reached the UI.
 */
export interface MyShare {
  link_id: string;
  token: string;
  url: string;
  /** The file's or folder's name, resolved server-side. Never null. */
  display_name: string;
  file_id: string | null;
  file_name: string | null;
  folder_id: string | null;
  folder_name: string | null;
  is_folder: boolean;
  is_bundle: number;
  /** NULL for folder shares - a subtree has no single size to report. */
  size_bytes: number | null;
  extension: string | null;
  region: string | null;
  is_password_protected: number;
  lock_mode: ShareLockMode;
  access_mode: ShareAccessMode;
  recipient_count: number;
  is_revoked: number;
  revoked_at: number | null;
  expires_at: number | null;
  view_count: number;
  download_count: number;
  /** Download ceiling (migration 0143). NULL = unlimited. */
  max_downloads: number | null;
  shared_at: number;
  created_by: string;
  sharer_name: string | null;
  status: ShareStatus;
  is_mine: boolean;
}

/** The `stats` block GET /api/shares returns alongside the rows. */
export interface ShareStats {
  total: number;
  active: number;
  expiring: number;
  total_views: number;
}

export interface MySharesPage {
  links: MyShare[];
  stats: ShareStats;
}

// ── Analytics ───────────────────────────────────────────────────────

/** Ranges GET /api/shares/:id/analytics accepts. Anything else is a 400. */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface ShareAnalyticsLink {
  link_id: string;
  url: string;
  display_name: string;
  is_folder: boolean;
  is_bundle: boolean;
  file_id: string | null;
  size_bytes: number | null;
  extension: string | null;
  region: string | null;
  created_at: number;
  created_by: string;
  created_by_name: string | null;
  is_mine: boolean;
  expires_at: number | null;
  is_revoked: boolean;
  revoked_at: number | null;
  is_password_protected: boolean;
  lock_mode: ShareLockMode;
  access_mode: ShareAccessMode;
  status: ShareStatus;
  view_count: number;
  download_count: number;
  max_downloads: number | null;
  /** Downloads still available, or null when uncapped. Computed server-side. */
  downloads_left: number | null;
}

export interface TimelinePoint {
  /** ISO date, one per day in range. */
  day: string;
  opens: number;
  downloads: number;
}

export interface ShareRecipient {
  email: string;
  /**
   * Set when the one-time code was accepted. Proof the person reached the
   * file - NOT a per-open timestamp, and the UI must not present it as one.
   */
  verified_at: number | null;
  invited_at: number;
}

export interface AccessLogRow {
  id: string;
  /** First 8 characters of the visitor's IP hash - an opaque handle, not an identity. */
  visitor: string;
  event: "view" | "download";
  device: "desktop" | "mobile" | "tablet" | "unknown";
  device_label: string;
  /** ISO 3166-1 alpha-2, or null when the edge did not report one. */
  country: string | null;
  viewed_at: number;
}

export interface ShareAnalytics {
  link: ShareAnalyticsLink;
  range: AnalyticsRange;
  timeline: TimelinePoint[];
  reach: {
    visitors: number;
    truncated: boolean;
    devices: { name: string; count: number }[];
    browsers: { name: string; count: number }[];
  };
  /** Null for a public link - there is no recipient list to report. */
  recipients: ShareRecipient[] | null;
  log: { total: number; offset: number; limit: number; rows: AccessLogRow[] };
  /**
   * What the numbers above cannot answer, in the API's own words. Rendered
   * verbatim so a small chart never implies more than it knows.
   */
  gaps: { repeat_visits: string; per_recipient: string | null };
}

// ── Editing ─────────────────────────────────────────────────────────

/**
 * Body of PATCH /api/shares/:id. Every field is optional and absence means
 * "leave this column alone" - so changing an expiry does not require restating
 * the password, and vice versa.
 */
export interface ShareUpdateInput {
  expiresAt?: number | null;
  /** 0 is the API's spelling of "never". */
  expiresInDays?: number | null;
  /** A string sets the password; `null` removes it. */
  password?: string | null;
  lockMode?: ShareLockMode;
  accessMode?: ShareAccessMode;
  recipientEmails?: string[];
  /** A number sets the download ceiling; `null` clears it back to unlimited. */
  maxDownloads?: number | null;
}

export interface ResolvedShare {
  fileId: string | null;
  folderId: string | null;
  name: string;
  sizeBytes: number | null;
  requiresPassword: boolean;
}

// ── Shared with me ──────────────────────────────────────────────────

/**
 * A private link somebody else sent to this account (GET /api/shares/with-me).
 *
 * Deliberately NOT a MyShare: a recipient gets no view or download counts,
 * because those are the sender's analytics about everyone they shared with.
 * What a recipient is entitled to is who sent it, when, and whether they
 * themselves have opened it.
 */
export interface SharedWithMe {
  link_id: string;
  url: string;
  display_name: string;
  is_folder: boolean;
  is_bundle: boolean;
  size_bytes: number | null;
  extension: string | null;
  is_password_protected: number;
  lock_mode: ShareLockMode;
  expires_at: number | null;
  revoked_at: number | null;
  status: ShareStatus;
  shared_at: number;
  invited_at: number;
  /** When YOU first proved this address; null if you have never opened it. */
  verified_at: number | null;
  sender_name: string | null;
}

export interface SharedWithMePage {
  links: SharedWithMe[];
  /** False means the account's address is unverified, so the list is empty BY RULE. */
  emailVerified: boolean;
  stats: { total: number; active: number; unopened: number };
}
