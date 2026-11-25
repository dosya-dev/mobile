import { apiRequest } from "@/api";
import { t } from "@/lib/i18n";
import type { Workspace, FileItem, FileDetail, FolderItem, FileListPage, SearchResults, FileFilter, FileSort, FileVersion } from "./types";

// GET /api/search returns thinner rows than /api/files: file rows omit
// lock_mode/share_count/comment_count/current_version/updated_at, folder rows omit
// lock_mode/is_synced. These types describe the raw wire shape so the normalization
// below is required (not just defensive) at the type level.
// (file_count is listed too: search does select it, but it's kept optional so a folder
// row missing it falls back to 0 rather than rendering NaN.)
export type SearchFileRow = Omit<FileItem, "lock_mode" | "share_count" | "comment_count" | "current_version" | "updated_at"> &
  Partial<Pick<FileItem, "lock_mode" | "share_count" | "comment_count" | "current_version" | "updated_at">>;
type SearchFolderRow = Omit<FolderItem, "lock_mode" | "file_count" | "is_synced" | "is_hidden" | "hidden_mode"> &
  Partial<Pick<FolderItem, "lock_mode" | "file_count" | "is_synced" | "is_hidden" | "hidden_mode">>;

export async function getWorkspaces(): Promise<Workspace[]> {
  const res = await apiRequest<{ ok: true; workspaces: Workspace[] }>("/api/workspaces");
  return res.workspaces;
}

/**
 * Create a workspace. The name and its location: the server derives the initials
 * and applies its own default colour, which is what web's create page does when
 * you don't customise them. The free plan caps owned workspaces, and that error
 * is surfaced to the caller.
 *
 * `defaultRegion` is where every file in the workspace will live. It is settled
 * here and nowhere else - the server refuses to move a workspace afterwards and
 * ignores a region on any upload. Omitted rather than sent empty when the caller
 * has none, so the request unambiguously asks the server to suggest one from the
 * request's geography. (The server trims and truthiness-checks the field, so ""
 * takes that same path today; sending a key that carries nothing would only
 * invite a future caller to fill it in.)
 */
export async function createWorkspace(name: string, defaultRegion?: string): Promise<Workspace> {
  const res = await apiRequest<{ ok: true; workspace: Workspace }>("/api/workspaces", {
    method: "POST",
    body: { name, ...(defaultRegion ? { default_region: defaultRegion } : {}) },
  });
  return res.workspace;
}

export interface ListFilesParams {
  workspaceId: string;
  folderId: string | null;
  filter?: FileFilter;
  sort?: FileSort;
  q?: string;
  page?: number;
  perPage?: number;
}

export async function listFiles(p: ListFilesParams): Promise<FileListPage> {
  const qs = new URLSearchParams();
  qs.set("workspace_id", p.workspaceId);
  if (p.folderId) qs.set("folder_id", p.folderId);
  // `hidden` is its own query param server-side, not a value of `filter`.
  // Resolving that here rather than in the screen: a screen that has to remember
  // which of its own filters are really a different parameter is a screen that
  // will get it wrong. Sending filter=hidden fails silently - the API ignores
  // the unknown value and returns the unfiltered listing.
  if (p.filter === "hidden") qs.set("hidden", "1");
  else if (p.filter) qs.set("filter", p.filter);
  if (p.sort) qs.set("sort", p.sort);
  if (p.q) qs.set("q", p.q);
  qs.set("page", String(p.page ?? 1));
  qs.set("per_page", String(p.perPage ?? 100));
  return apiRequest<{ ok: true } & FileListPage>(`/api/files?${qs.toString()}`);
}

export async function getFile(id: string): Promise<FileDetail> {
  const res = await apiRequest<{ ok: true; file: FileDetail }>(`/api/files/${id}`);
  return res.file;
}

export async function getDownloadUrl(id: string, unlockToken?: string, ttlSeconds?: number): Promise<string> {
  // NOTE: verify the URL field name against the handler (url vs download_url).
  const qs = new URLSearchParams();
  if (unlockToken) qs.set("ut", unlockToken);
  if (ttlSeconds) qs.set("ttl", String(ttlSeconds));
  // .toString(), not .size - Hermes does not implement URLSearchParams.size.
  const encoded = qs.toString();
  const suffix = encoded ? `?${encoded}` : "";
  const res = await apiRequest<{ ok: true; url?: string; download_url?: string }>(`/api/files/${id}/download-url${suffix}`);
  const url = res.url ?? res.download_url;
  if (!url) throw new Error(t("common.error.noDownloadURLInResponse"));
  return url;
}

// GET /api/favourites returns favourite-row shapes, not FileItem/FolderItem: file
// rows carry `id` as the favourite row id (real file id is `file_id`) and omit
// lock_mode/current_version/share_count/comment_count/updated_at; folder rows
// likewise use `id` for the favourite row and `folder_id` for the real folder id.
interface FavouriteFileRow {
  id: string;
  file_id: string;
  created_at: number;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  extension: string | null;
  /** Optional: older servers don't select it. Absent must NOT read as unrestricted. */
  lock_mode?: string;
  current_version?: number;
}
interface FavouriteFolderRow {
  id: string;
  folder_id: string;
  folder_name: string;
  parent_id: string | null;
  created_at: number;
}

export async function getFavourites(workspaceId: string): Promise<SearchResults> {
  const qs = new URLSearchParams({ workspace_id: workspaceId });
  const res = await apiRequest<{ ok: true; files?: FavouriteFileRow[]; folders?: FavouriteFolderRow[] }>(`/api/favourites?${qs.toString()}`);
  return {
    files: (res.files ?? []).map((r) => ({
      id: r.file_id,
      name: r.file_name,
      size_bytes: r.size_bytes,
      mime_type: r.mime_type,
      extension: r.extension ?? null,
      created_at: r.created_at,
      updated_at: r.created_at,
      current_version: r.current_version ?? 1,
      // Defaulting this to "none" told the app a view-only file was ordinary,
      // and the disk-cache policy believed it. An older server that omits the
      // column now yields "unknown", which every lock check treats as
      // restricted - slower, never wrong.
      lock_mode: r.lock_mode ?? "unknown",
      share_count: 0,
      comment_count: 0,
    })),
    folders: (res.folders ?? []).map((r) => ({
      id: r.folder_id,
      name: r.folder_name,
      created_at: r.created_at,
      lock_mode: "none",
      file_count: 0,
      // /api/favourites doesn't select is_synced, so favourites show the plain folder icon.
      // Web does the same: only its files page passes isSynced to folderIconSrc.
      is_synced: 0,
      // Nor is_hidden: a favourited folder you'd hidden still lists here, same as web.
      is_hidden: 0,
      hidden_mode: "none",
    })),
  };
}

export async function getVersions(id: string): Promise<{ current: number; versions: FileVersion[] }> {
  const res = await apiRequest<{ ok: true; current_version: number; versions: FileVersion[] }>(`/api/files/${id}/versions`);
  return { current: res.current_version, versions: res.versions ?? [] };
}

/**
 * One page of the trash, as the web files page reads it: trashed folders (at
 * the top level, one row per folder the user deleted, with the files that
 * went with it collapsed into its counts) and the files trashed on their own.
 * `folderId` browses INTO a trashed folder. Files swept in with a folder never
 * appear at the top level, which is why a Trash that lists only files loses
 * them - see the folder rows.
 */
export async function getTrash(
  workspaceId: string,
  opts: { folderId?: string | null; page?: number } = {},
): Promise<FileListPage> {
  const qs = new URLSearchParams({ workspace_id: workspaceId, deleted: "1" });
  if (opts.folderId) qs.set("folder", opts.folderId);
  qs.set("page", String(opts.page ?? 1));
  qs.set("per_page", "100");
  const res = await apiRequest<{ ok: true } & FileListPage>(`/api/files?${qs.toString()}`);
  return { ...res, folders: res.folders ?? [], files: res.files ?? [] };
}

/**
 * A /api/search file row (or an AI search content hit, which is the same row
 * plus its match) as a FileItem: safe defaults for the columns search omits.
 */
export function normalizeSearchFile<R extends SearchFileRow>(f: R): R & FileItem {
  return {
    share_count: 0,
    comment_count: 0,
    current_version: 1,
    updated_at: f.created_at,
    ...f,
    // After the spread, so an older server that omits the column cannot land
    // on "none" - which would mark a view-only hit as freely cacheable.
    lock_mode: f.lock_mode ?? "unknown",
  };
}

export async function search(workspaceId: string, q: string): Promise<SearchResults> {
  const qs = new URLSearchParams({ workspace_id: workspaceId, q });
  const res = await apiRequest<{ ok: true; files: SearchFileRow[]; folders: SearchFolderRow[] }>(`/api/search?${qs.toString()}`);
  // Normalize with safe defaults so FileRow/FolderRow render correctly (e.g.
  // `lock_mode !== "none"` would otherwise show a lock badge on every result).
  return {
    files: (res.files ?? []).map(normalizeSearchFile),
    folders: (res.folders ?? []).map((f) => ({
      lock_mode: "none",
      file_count: 0,
      is_synced: 0,
      is_hidden: 0,
      hidden_mode: "none",
      ...f,
    })),
  };
}

export interface RegionInfo { code: string; city: string; country: string; continent: string; flag: string }

/**
 * The locations a workspace can be created in, plus the server's nearest-location
 * suggestion for whoever is asking - so the create step preselects a sensible one
 * rather than presenting an empty required field.
 *
 * Defaults rather than assertions on the response: an app can outrun its API
 * deploy, and a missing catalog must degrade to "no locations offered" (the
 * create step then submits without one) rather than to a crash.
 */
export async function getRegions(): Promise<{ regions: RegionInfo[]; suggested: string }> {
  const res = await apiRequest<{ ok: true; regions?: RegionInfo[]; suggested?: string }>("/api/regions");
  return { regions: res.regions ?? [], suggested: res.suggested ?? "" };
}

export interface WorkspaceStorage { used: number; total: number; free: number }

export async function getWorkspaceStorage(workspaceId: string): Promise<WorkspaceStorage | null> {
  const res = await apiRequest<{ ok: true; storage?: WorkspaceStorage | null }>(`/api/workspaces/${workspaceId}`);
  return res.storage ?? null;
}
