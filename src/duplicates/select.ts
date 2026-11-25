export interface DuplicateFile {
  id: string;
  name: string;
  folder_id: string | null;
  folder_path: string | null;
  created_at: number;
  uploaded_by: string;
  uploader_name: string | null;
  mime_type: string;
  extension: string | null;
}

export interface DuplicateGroup {
  content_hash: string;
  size_bytes: number;
  count: number;
  /** (count - 1) * size_bytes - what deleting all but one copy reclaims. */
  wasted_bytes: number;
  /** Newest-first: the server sorts created_at DESC (lib/duplicates/group.ts). */
  files: DuplicateFile[];
}

/** POST /api/files/batch-delete caps file_ids at 500 per request. */
export const DELETE_CHUNK = 500;

/**
 * Every copy except the newest in each group.
 *
 * Index 0 is the keeper because the API sorts created_at DESC. If that ordering
 * ever changes this quietly starts selecting the copy the user wanted to keep,
 * which is why it has a test naming the ids rather than the count.
 */
export function allButNewest(groups: DuplicateGroup[]): string[] {
  return groups.flatMap((g) => g.files.slice(1).map((f) => f.id));
}

/** Immutable toggle - the screen holds selection in state and must not mutate it. */
export function toggle(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Groups with EVERY copy selected.
 *
 * Selecting them all is allowed - web allows it too - but it is the one action
 * that leaves no copy of a file behind, so the confirm step names it.
 */
export function fullySelectedGroups(groups: DuplicateGroup[], selected: Set<string>): number {
  return groups.filter((g) => g.files.length > 0 && g.files.every((f) => selected.has(f.id))).length;
}

/** Bytes reclaimed by the current selection (each copy weighs its group's size). */
export function selectedBytes(groups: DuplicateGroup[], selected: Set<string>): number {
  return groups.reduce(
    (sum, g) => sum + g.files.reduce((s, f) => s + (selected.has(f.id) ? g.size_bytes : 0), 0),
    0,
  );
}

/**
 * How many selected ids are still present in the groups.
 *
 * Not `selected.size`: a refetch can drop a file that was deleted elsewhere
 * while it sat selected here, and a stale id would inflate the number the
 * confirm dialog promises to delete.
 */
export function selectedCount(groups: DuplicateGroup[], selected: Set<string>): number {
  const live = new Set(groups.flatMap((g) => g.files.map((f) => f.id)));
  let n = 0;
  for (const id of selected) if (live.has(id)) n++;
  return n;
}

export function chunk<T>(items: T[], size: number = DELETE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
