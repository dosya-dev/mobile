import { apiRequest } from "@/api";

/** Groups are per-user, not per-workspace-member: /api/groups filters on user_id too. */
export interface GroupFolderItem {
  item_id: string;
  folder_id: string;
  folder_name: string;
  parent_id: string | null;
}

export interface GroupFileItem {
  item_id: string;
  file_id: string;
  file_name: string;
  size_bytes: number;
  extension: string | null;
  folder_id: string | null;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
  folders: GroupFolderItem[];
  files: GroupFileItem[];
}

export async function getGroups(workspaceId: string): Promise<Group[]> {
  const res = await apiRequest<{ ok: true; groups?: Group[] }>(
    `/api/groups?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
  return res.groups ?? [];
}

/** Colour defaults to the server's own #706E69 when omitted. */
export async function createGroup(workspaceId: string, name: string, color?: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/groups", {
    method: "POST",
    body: color ? { workspace_id: workspaceId, name, color } : { workspace_id: workspaceId, name },
  });
}

export async function renameGroup(id: string, name: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/groups/${id}`, { method: "PUT", body: { name } });
}

export async function deleteGroup(id: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/groups/${id}`, { method: "DELETE" });
}

/** Adding is a POST to the group itself with the item in the body - not a nested route. */
export async function addFolderToGroup(groupId: string, folderId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/groups/${groupId}`, { method: "POST", body: { folder_id: folderId } });
}

export async function addFileToGroup(groupId: string, fileId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/groups/${groupId}`, { method: "POST", body: { file_id: fileId } });
}

export async function removeFolderFromGroup(groupId: string, folderId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/groups/${groupId}/folders/${folderId}`, { method: "DELETE" });
}

export async function removeFileFromGroup(groupId: string, fileId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/groups/${groupId}/files/${fileId}`, { method: "DELETE" });
}
