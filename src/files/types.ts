export interface Workspace {
  id: string;
  name: string;
  slug: string;
  /** Per-workspace quota from the list endpoint (absent on older servers). */
  // `total` is the workspace's own ceiling (admin cap when set, the
  // owner's entitlement when not); `free` is what will actually fit, which
  // `total - used` cannot know - sibling workspaces drain the same pool.
  storage?: { used: number; total: number; free?: number } | null;
  icon_initials: string | null;
  icon_color: string | null;
  // An R2 key, not a URL - a presence flag. Fetch the image from
  // workspaceIconUrl(id) only when this is non-null.
  icon_image_url: string | null;
  role_id: string;
  joined_at: number;
  /**
   * Where this workspace's files are stored, fixed when it was created. The
   * list endpoint has always selected it (`w.default_region`, spread into each
   * row); mobile simply never declared it. Optional so an older server that
   * omits it reads as "unknown location" rather than as an empty one.
   */
  default_region?: string;
}

export interface FileItem {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  extension: string | null;
  created_at: number;
  updated_at: number;
  current_version: number;
  lock_mode: string; // "none" | "view_only" | "full_lock"
  share_count: number;
  comment_count: number;
  /**
   * 0/1 from D1, and who it's hidden from ("none" | "everyone" | "users" |
   * "roles") - present on the real listing response (see the FileDetail note
   * above), just never declared here before now. Optional because the SAME
   * type also describes rows built by surfaces that don't select them (a
   * search hit, a favourites row).
   */
  is_hidden?: number;
  hidden_mode?: string;
  /**
   * Who uploaded this file. Needed to evaluate `delete_own_files`, which is
   * what most roles hold instead of `delete_any_file` - without it the UI
   * cannot tell whether Delete on THIS row will be allowed. Optional for the
   * same reason as the two fields above: rows built by search or favourites
   * do not select it, and nullable because FileDetail - which extends this -
   * gets the column from a LEFT JOIN.
   */
  uploaded_by?: string | null;
  /** Live Photo pairing from the API: a still names its twin video, a twin names its still. */
  live_video_id?: string | null;
  live_photo_id?: string | null;
}

/**
 * What `GET /api/files/:id` returns on top of a listing row.
 *
 * The single-file endpoint has always selected these columns (region,
 * uploader_name, folder_id, the deleted_at tombstone) - mobile simply never
 * declared them, so every one of them was parsed and thrown away. The viewer's
 * details panel reads them; nothing here needed an API change.
 *
 * They stay optional because the SAME type describes rows that reached the
 * viewer from a listing, a search hit or a favourites row, none of which select
 * this much. A details row that is absent renders as nothing, not as "null".
 */
export interface FileDetail extends FileItem {
  region?: string | null;
  uploader_name?: string | null;
  uploaded_by?: string | null;
  folder_id?: string | null;
  workspace_id?: string;
  // is_hidden/hidden_mode now live on FileItem itself.
  deleted_at?: number | null;
}

export interface FolderItem {
  id: string;
  name: string;
  created_at: number;
  lock_mode: string;
  file_count: number;
  /** 0/1 from D1 - set when the folder is a backup target. Drives the folder icon. */
  is_synced: number;
  /** 0/1; `hidden_mode` says who it's hidden from ("none" | "everyone" | "users" | "roles"). */
  is_hidden: number;
  hidden_mode: string;
  /** Who created it; the trash's restore and purge are judged on it with delete_own_files. */
  created_by?: string | null;
  /**
   * Trash listing only. A trash root is a folder the user deleted themselves;
   * only those can be restored or purged. A folder surfaced by browsing into
   * a trashed folder is not one, and both endpoints answer 400 for it.
   */
  is_trash_root?: boolean;
  /** Trash listing, roots only: the bytes of the files that went to the trash with this folder. */
  trashed_size_bytes?: number;
  deleted_at?: number | null;
}

export interface Pagination {
  page: number;
  per_page: number;
  total_files: number;
  total_pages: number;
}

export interface FileListPage {
  folders: FolderItem[];
  files: FileItem[];
  breadcrumbs: { id: string; name: string }[];
  pagination: Pagination;
  /**
   * Whether this member's role may lock / hide. /api/files has always sent
   * both and no client read them, so Lock and Hide were offered to every role
   * while only an owner's taps actually worked.
   */
  can_lock?: boolean;
  can_hide?: boolean;
}

export interface SearchResults {
  files: FileItem[];
  folders: FolderItem[];
}

export type FileFilter = "all" | "documents" | "images" | "videos" | "shared" | "hidden";
export type FileSort = "newest" | "oldest" | "name_asc" | "name_desc" | "largest" | "smallest";

export interface FileVersion {
  id: string;
  version_number: number;
  size_bytes: number;
  uploader_name: string | null;
  created_at: number;
}
