import { apiRequest } from "@/api";
import { shareUrl } from "./config";
import { buildEmailShareBody, buildLinkShareBody, buildShareUpdateBody } from "./payload";
import type {
  ShareLink, MyShare, MySharesPage, ResolvedShare, ShareAnalytics, AnalyticsRange,
  ShareUpdateInput, ShareLockMode, ShareAccessMode, SharedWithMe, SharedWithMePage,
} from "./types";

export interface CreateLinkOpts {
  expiresInDays?: number;
  /** An absolute instant, for a date the user picked. Wins over expiresInDays. */
  expiresAt?: number;
  password?: string;
  lockMode?: ShareLockMode;
  maxDownloads?: number | null;
  /** Serve photos without EXIF/XMP/IPTC (API migration 0183). */
  stripMetadata?: boolean;
}

export async function createShareLink(fileId: string, opts: CreateLinkOpts): Promise<ShareLink> {
  const body = buildLinkShareBody(opts);
  const res = await apiRequest<{ ok: true; link: ShareLink }>(`/api/files/${fileId}/share`, { method: "POST", body });
  return { ...res.link, url: res.link.url ?? shareUrl(res.link.token) };
}

export interface EmailOpts {
  emails: string[];
  message?: string;
  password?: string;
  expiresInDays?: number;
  expiresAt?: number;
  lockMode?: ShareLockMode;
  maxDownloads?: number | null;
  /** Serve photos without EXIF/XMP/IPTC (API migration 0183). */
  stripMetadata?: boolean;
  /** When true the link only opens for the named recipients. */
  restrictToRecipients: boolean;
}

export async function shareViaEmail(fileId: string, opts: EmailOpts): Promise<void> {
  // One request carrying the whole recipient list. A restricted link has to be
  // a single link bound to that list; one call per address would mint N links
  // and make "only these people" a claim the data does not support.
  const body = buildEmailShareBody(opts);
  await apiRequest<{ ok: true; share_url?: string }>(`/api/files/${fileId}/share-email`, {
    method: "POST",
    body,
  });
}

/**
 * Create a share link for a whole folder. Contents resolve at access time, so
 * anything added to the folder later is covered by the same link. Hidden and
 * locked items inside it are never included.
 */
export async function createFolderShareLink(folderId: string, opts: CreateLinkOpts): Promise<ShareLink> {
  const body = buildLinkShareBody(opts);
  const res = await apiRequest<{ ok: true; link: ShareLink }>(`/api/folders/${folderId}/share`, { method: "POST", body });
  return { ...res.link, url: res.link.url ?? shareUrl(res.link.token) };
}

/** Create a folder share link and mail it. */
export async function shareFolderViaEmail(folderId: string, opts: EmailOpts): Promise<void> {
  const body = buildEmailShareBody(opts);
  await apiRequest<{ ok: true; share_url?: string }>(`/api/folders/${folderId}/share-email`, {
    method: "POST",
    body,
  });
}

/**
 * How many items a folder link will NOT carry - hidden from the sharer, or
 * locked. Advisory: the sharer sees it before committing rather than hearing
 * about a partial share from a confused recipient later.
 */
export async function getFolderShareExclusions(folderId: string): Promise<number> {
  const res = await apiRequest<{ ok: true; excluded_count?: number }>(`/api/folders/${folderId}/share`);
  return res.excluded_count ?? 0;
}

/**
 * The workspace's default share expiry in days, or null when it sets none.
 *
 * Read before the share sheet opens so the picker starts on the workspace's
 * choice. Advisory in the same way web treats it: a failed read leaves the
 * product default in place rather than blocking the sheet.
 */
export async function getWorkspaceDefaultExpiryDays(workspaceId: string): Promise<number | null> {
  const res = await apiRequest<{ ok: boolean; settings: { default_share_expiry_days?: number | null } | null }>(
    `/api/workspaces/${workspaceId}/settings`,
  );
  return res.settings?.default_share_expiry_days ?? null;
}

export async function listMyShares(workspaceId: string): Promise<MySharesPage> {
  const qs = new URLSearchParams({ workspace_id: workspaceId });
  const res = await apiRequest<{ ok: true; links: MyShare[]; stats?: MySharesPage["stats"] }>(`/api/shares?${qs.toString()}`);
  return {
    links: res.links ?? [],
    // The endpoint has always returned these; nothing on mobile read them.
    // Derived here only as a fallback so an older API cannot blank the header.
    stats: res.stats ?? {
      total: res.links?.length ?? 0,
      active: (res.links ?? []).filter((l) => l.status === "active").length,
      expiring: (res.links ?? []).filter((l) => l.status === "expiring").length,
      total_views: (res.links ?? []).reduce((sum, l) => sum + (l.view_count ?? 0), 0),
    },
  };
}

/**
 * Private links other people sent to this address.
 *
 * Not workspace-scoped: a link can be sent to you from a workspace you are not
 * a member of, which is exactly the case the sender meant to cover.
 */
export async function listSharedWithMe(): Promise<SharedWithMePage> {
  const res = await apiRequest<{
    ok: true; links: SharedWithMe[]; email_verified?: boolean;
    stats?: SharedWithMePage["stats"];
  }>("/api/shares/with-me");
  const links = res.links ?? [];
  return {
    links,
    emailVerified: res.email_verified !== false,
    stats: res.stats ?? {
      total: links.length,
      active: links.filter((l) => l.status === "active").length,
      unopened: links.filter((l) => l.verified_at === null && l.status !== "revoked").length,
    },
  };
}

export async function revokeShare(linkId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/shares/${linkId}/revoke`, { method: "POST" });
}

/** Everything the detail screen draws: counters, timeline, reach, recipients, log. */
export async function getShareAnalytics(linkId: string, range: AnalyticsRange): Promise<ShareAnalytics> {
  const qs = new URLSearchParams({ range: String(range) });
  return await apiRequest<ShareAnalytics & { ok: true }>(`/api/shares/${linkId}/analytics?${qs.toString()}`);
}

export interface UpdatedShare {
  link_id: string;
  expires_at: number | null;
  is_password_protected: number;
  lock_mode: ShareLockMode;
  access_mode: ShareAccessMode;
  recipient_count: number;
  download_count: number;
  max_downloads: number | null;
}

/**
 * Change a live link without minting a new token, so every URL already sent
 * keeps working. Only the fields present in `input` are written.
 */
export async function updateShare(linkId: string, input: ShareUpdateInput): Promise<UpdatedShare> {
  const body = buildShareUpdateBody(input);
  const res = await apiRequest<{ ok: true; link: UpdatedShare }>(`/api/shares/${linkId}`, { method: "PATCH", body });
  return res.link;
}

// ── The recipient's side ────────────────────────────────────────────

export interface ShareFile {
  id: string;
  name: string;
  size_bytes?: number;
  mime_type?: string;
  extension?: string;
  family?: string;
}

export interface ShareFolderView {
  root_id: string;
  root_name: string;
  current_id: string;
  current_name: string;
  breadcrumb: { id: string; name: string }[];
  subfolders: { id: string; name: string }[];
}

/**
 * A resolved share link, in every shape GET /api/share/:token can return.
 *
 * The four gates a recipient can hit are distinct states, not one error:
 * a password prompt, a "prove you own this address" code flow, a revoked or
 * expired link, and a link that opens. The previous mobile client collapsed
 * the last three into a single sentence.
 */
export interface SharePayload {
  isFolder: boolean;
  isBundle: boolean;
  /** "view_only" means the recipient may look but never download. */
  lockMode: ShareLockMode;
  requiresPassword: boolean;
  /** A private link: the visitor must confirm an invited address with a code. */
  requiresRecipientVerification: boolean;
  files: ShareFile[];
  file: ShareFile | null;
  folder: ShareFolderView | null;
  viewCount: number;
  downloadCount: number;
  expiresAt: number | null;
}

type RawShare = {
  ok: true;
  is_folder?: boolean;
  is_bundle?: boolean;
  lock_mode?: string;
  is_password_protected?: boolean | number;
  requires_recipient_verification?: boolean;
  files?: ShareFile[];
  file?: ShareFile | null;
  folder?: ShareFolderView | null;
  link?: { view_count?: number; download_count?: number; expires_at?: number | null };
};

function toPayload(res: RawShare): SharePayload {
  return {
    isFolder: !!res.is_folder,
    isBundle: !!res.is_bundle,
    lockMode: (res.lock_mode as ShareLockMode) ?? "none",
    // `is_password_protected` describes the LINK, not the visitor - a protected
    // link the visitor has already unlocked still reports it. The payload is
    // what distinguishes them, so the gate is "protected AND nothing came
    // back". `folder` has to be in that test too: an unlocked folder share
    // whose current directory happens to be empty has no file and no files,
    // and without this it would be sent back to the password prompt it had
    // just passed.
    requiresPassword: !!res.is_password_protected
      && !res.file
      && !res.folder
      && (res.files?.length ?? 0) === 0,
    requiresRecipientVerification: !!res.requires_recipient_verification,
    files: res.files ?? [],
    file: res.file ?? null,
    folder: res.folder ?? null,
    viewCount: res.link?.view_count ?? 0,
    downloadCount: res.link?.download_count ?? 0,
    expiresAt: res.link?.expires_at ?? null,
  };
}

/**
 * Open a share link.
 *
 * Public - no auth needed. A gate (password, or recipient verification) comes
 * back as HTTP 200 with the flag set and no file payload. Revoked and expired
 * links throw (410 -> ApiError) and are deliberately left to propagate so the
 * screen can tell those two apart instead of showing a password prompt.
 *
 * `pathId` navigates inside a shared folder; the API resolves the subtree and
 * refuses anything outside it, so this cannot be aimed at another folder.
 */
export async function openShare(token: string, pathId?: string): Promise<SharePayload> {
  const qs = pathId ? `?path_id=${encodeURIComponent(pathId)}` : "";
  const res = await apiRequest<RawShare>(`/api/share/${token}${qs}`, { skipRefresh: true });
  return toPayload(res);
}

export async function unlockShare(token: string, password: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/share/${token}/unlock`, { method: "POST", body: { password }, skipRefresh: true });
}

/** Private links: mail a one-time code to an address on the link's recipient list. */
export async function requestShareCode(token: string, email: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/share/${token}/request-code`, {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
    skipRefresh: true,
  });
}

/** Exchange the emailed code for the recipient grant that opens the link. */
export async function verifyShareCode(token: string, email: string, code: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/share/${token}/verify-code`, {
    method: "POST",
    body: { email: email.trim().toLowerCase(), code: code.trim() },
    skipRefresh: true,
  });
}

/**
 * Backwards-compatible resolve used by callers that only need "what is behind
 * this token". Kept so the deep-link handler and its tests do not have to know
 * about folder navigation or the code flow.
 */
export async function resolveShare(token: string): Promise<ResolvedShare> {
  const p = await openShare(token);
  if (p.requiresPassword) {
    return { fileId: null, folderId: null, name: "", sizeBytes: null, requiresPassword: true };
  }
  if (p.folder) {
    return { fileId: null, folderId: p.folder.current_id, name: p.folder.current_name, sizeBytes: null, requiresPassword: false };
  }
  if (p.file) {
    return { fileId: p.file.id, folderId: null, name: p.file.name, sizeBytes: p.file.size_bytes ?? null, requiresPassword: false };
  }
  return { fileId: null, folderId: null, name: "", sizeBytes: null, requiresPassword: false };
}
