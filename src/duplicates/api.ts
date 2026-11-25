import { apiRequest } from "@/api/client";
import { chunk, type DuplicateGroup } from "./select";

export interface DuplicatesResponse {
  groups: DuplicateGroup[];
  total_groups: number;
  total_wasted_bytes: number;
  /** Files whose content hash is not computed yet. Above zero, the list is partial. */
  pending: number;
}

export async function getDuplicates(workspaceId: string): Promise<DuplicatesResponse> {
  const qs = new URLSearchParams({ workspace_id: workspaceId });
  const res = await apiRequest<{
    ok: true;
    groups?: DuplicateGroup[];
    total_groups?: number;
    total_wasted_bytes?: number;
    scanning?: { pending: number };
  }>(`/api/duplicates?${qs.toString()}`);
  return {
    groups: res.groups ?? [],
    total_groups: res.total_groups ?? 0,
    total_wasted_bytes: res.total_wasted_bytes ?? 0,
    pending: res.scanning?.pending ?? 0,
  };
}

/**
 * Move the selected copies to trash.
 *
 * Chunked because batch-delete caps file_ids at 500. Returns how many were
 * actually accepted: a partial failure must not report as a clean sweep, and on
 * a phone a dropped connection halfway through is the normal case, not the
 * exotic one.
 */
export async function deleteDuplicates(
  workspaceId: string,
  fileIds: string[],
): Promise<{ deleted: number; total: number }> {
  let deleted = 0;
  for (const ids of chunk(fileIds)) {
    await apiRequest("/api/files/batch-delete", {
      method: "POST",
      body: { workspace_id: workspaceId, file_ids: ids },
    });
    deleted += ids.length;
  }
  return { deleted, total: fileIds.length };
}
