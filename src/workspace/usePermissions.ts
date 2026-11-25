/**
 * The signed-in user's own permissions in the active workspace.
 *
 * This app knew a role only well enough to print a badge. Nothing was gated on
 * one: Lock, Hide, Delete, Rename and Upload were offered to every role, and a
 * viewer's first honest feedback was a 403 toast.
 *
 * The API remains the authority - this is for hiding doors known to be locked.
 *
 * FAILURE MODE, ON PURPOSE: while loading or on error, `can()` answers TRUE.
 * Failing closed would hide the whole app behind a network blip on a phone
 * that drops connectivity constantly, and read as a broken account. Failing
 * open shows a control that may 403. The server is what says no.
 */
import { useQuery } from "@tanstack/react-query";
import { getMyPermissions, type MyPermissions } from "./api";
import { useWorkspaceStore } from "@/files/workspaceStore";

export function usePermissions() {
  const activeId = useWorkspaceStore((s) => s.activeId);

  const { data } = useQuery<MyPermissions>({
    queryKey: ["me-permissions", activeId],
    queryFn: () => getMyPermissions(activeId!),
    enabled: !!activeId,
    staleTime: 60_000,
  });

  const permissions = data?.permissions;

  const can = (perm: string): boolean => {
    if (!permissions) return true;
    return permissions[perm] ?? false;
  };

  return {
    can,
    permissions,
    userId: data?.user_id ?? null,
    roleId: data?.role_id ?? null,
    roleName: data?.role_name ?? null,
    rootFolderId: data?.root_folder_id ?? null,
    rootFolderName: data?.root_folder_name ?? null,
  };
}
