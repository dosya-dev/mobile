import { apiRequest } from "@/api";

export interface WorkspaceDetail {
  workspace: {
    id: string; name: string; slug: string;
    icon_initials: string | null; icon_color: string | null; icon_image_url: string | null;
    owner_id: string; default_region: string; created_at: number; storage_used_bytes: number;
  };
  /** All of workspace_settings; null until a row exists. Fields are read defensively. */
  settings: Record<string, unknown> | null;
  role_id: string;
  is_owner: boolean;
  plan: string;
  storage: { used: number; total: number; free: number };
}

export interface RoleInfo {
  id: string;
  name: string;
  is_builtin?: boolean;
  is_custom?: boolean;
  permissions: Record<string, boolean>;
}

export interface TeamMember {
  /** The membership row id - NOT the user id. /api/team sends no `id` field. */
  membership_id: string;
  user_id: string;
  role_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  joined_at: number;
  /**
   * The caller's own row. Comes from the team payload, not from permissions,
   * so it is known the moment the list renders - which matters because can()
   * fails open while permissions load, and this is what keeps a manager from
   * being offered a Remove button that would remove themselves.
   */
  is_you: boolean;
}

export async function getWorkspaceDetail(id: string): Promise<WorkspaceDetail> {
  return await apiRequest<{ ok: true } & WorkspaceDetail>(`/api/workspaces/${id}`);
}

export async function updateWorkspaceName(id: string, name: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/workspaces/${id}`, { method: "PUT", body: { name } });
}

/** Partial update; the server permission-gates each field individually. */
export async function updateWorkspaceSettings(id: string, patch: Record<string, unknown>): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/workspaces/${id}/settings`, { method: "PUT", body: patch });
}

export async function getRoles(workspaceId: string): Promise<{ roles: RoleInfo[]; all_permissions: string[] }> {
  const res = await apiRequest<{ ok: true; roles: RoleInfo[]; all_permissions: string[] }>(
    `/api/roles?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
  return { roles: res.roles ?? [], all_permissions: res.all_permissions ?? [] };
}

export async function getTeam(workspaceId: string): Promise<{ members: TeamMember[] }> {
  const res = await apiRequest<{ ok: true; members?: TeamMember[] }>(
    `/api/team?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
  return { members: res.members ?? [] };
}

/** Invite by email into `role`. The caller needs the invite_members permission. */
export async function inviteToWorkspace(workspaceId: string, email: string, role = "role_member"): Promise<void> {
  await apiRequest<{ ok: true }>("/api/team/invite", {
    method: "POST",
    body: { workspace_id: workspaceId, email, role },
  });
}

/**
 * Move a member to another role.
 *
 * Takes the membership_id, like removeMember. Until PUT /api/team/members/:id
 * learned to write role_id, no client could change anyone's role at all - the
 * only way was to remove the person and invite them again.
 */
export async function changeMemberRole(membershipId: string, roleId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/team/members/${membershipId}`, {
    method: "PUT",
    body: { role_id: roleId },
  });
}

export interface MyPermissions {
  user_id: string;
  role_id: string;
  role_name: string | null;
  is_builtin: boolean;
  root_folder_id: string | null;
  root_folder_name: string | null;
  permissions: Record<string, boolean>;
}

/**
 * The caller's own permissions in one workspace.
 *
 * Nothing in this app was gated on a role: every screen offered Upload, Lock,
 * Hide and Delete to everyone, and a viewer's first feedback was a 403 toast.
 */
export async function getMyPermissions(workspaceId: string): Promise<MyPermissions> {
  return await apiRequest<{ ok: true } & MyPermissions>(
    `/api/me/permissions?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
}

/** Hand the workspace to another member. Owner only.
 *  Takes the target's **user_id**, not their membership_id. */
export async function transferOwnership(workspaceId: string, userId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/workspaces/${workspaceId}/transfer`, {
    method: "POST",
    body: { user_id: userId },
  });
}

/** Remove a member by membership id; the server derives the workspace from that row. */
export async function removeMember(membershipId: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/team/members/${membershipId}`, { method: "DELETE" });
}

export async function leaveWorkspace(id: string): Promise<void> {
  await apiRequest<{ ok: true }>(`/api/workspaces/${id}/leave`, { method: "POST" });
}

/**
 * Deliberately absent: deleteWorkspace().
 *
 * DELETE /api/workspaces/:id now requires a 6-digit code mailed to the owner
 * plus the workspace name retyped. That flow lives in the web app; the mobile
 * Danger zone links to it rather than shipping a call that always 400s.
 */
