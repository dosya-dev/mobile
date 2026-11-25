import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { useWorkspaceStore } from "./workspaceStore";
import { useFileMutations } from "./mutationHooks";
import { usePermissions } from "@/workspace/usePermissions";
import { describeProtection } from "./protection";
import type { FileItem } from "./types";
import { useT } from "@/lib/i18n";
import { useOfflineRow } from "@/offline/ui/offlineActions";

/**
 * Every entry is gated on the permission its endpoint actually checks. This
 * sheet used to offer Rename, Move, Copy, Share and Delete to every role, so a
 * viewer's only feedback was a row of 403 toasts.
 *
 * Delete follows the same rule files/[id]/index.ts applies: delete_any_file
 * covers everything, delete_own_files covers only this member's own uploads.
 *
 * Lock and Hide use `canLock` / `canHide` from the listing's can_lock /
 * can_hide. Both permissions are seeded owner-only and, until migration 0110,
 * no custom role could hold either - so on most workspaces these two rows
 * belong to the owner alone, which is exactly why they cannot be shown
 * unconditionally.
 */
export function FileActionsSheet(props: {
  file: FileItem; visible: boolean; onClose: () => void;
  onMove: (file: FileItem) => void; onCopy: (file: FileItem) => void; onVersions: (file: FileItem) => void;
  onRename: (file: FileItem) => void; onDelete: (file: FileItem) => void; onShare: (file: FileItem) => void;
  onLock: (file: FileItem) => void; onToggleHidden: (file: FileItem) => void;
  onComments: (file: FileItem) => void;
  /** Starts selection mode with this file ticked. Absent where the role can move nothing. */
  onSelect?: (file: FileItem) => void;
  /** From the listing's can_lock / can_hide. Default false: fail closed. */
  canLock?: boolean; canHide?: boolean;
}) {
  const t = useT();
  const workspaceId = useWorkspaceStore((s) => s.activeId) as string;
  const mut = useFileMutations();
  const { can, userId } = usePermissions();

  const canDelete = can("delete_any_file")
    || (can("delete_own_files") && props.file.uploaded_by === userId);

  // Ask about each control separately. describeProtection reports the STRONGEST
  // state it is given, so passing the whole file would print "Hidden from 3
  // roles" onto the Lock row.
  const lockState = describeProtection({ lock_mode: props.file.lock_mode });
  const hideState = describeProtection({
    hidden_mode: props.file.hidden_mode,
    hidden_rule_count: null,
  });
  const isHidden = props.file.is_hidden === 1;
  // Make available offline / Remove from offline; null when canPin refuses.
  const offline = useOfflineRow({ kind: "file", item: props.file }, workspaceId);

  const actions: SheetAction[] = [
    ...(props.onSelect ? [{ label: t("files.action.select"), icon: "checkmark-circle-outline" as const, onPress: () => props.onSelect?.(props.file) }] : []),
    ...(can("rename_files") ? [{ label: t("common.action.rename"), icon: "create-outline" as const, onPress: () => props.onRename(props.file) }] : []),
    ...(can("upload_files") ? [
      { label: t("files.action.move"), icon: "folder-outline" as const, onPress: () => props.onMove(props.file) },
      { label: t("files.action.copyFile"), icon: "copy-outline" as const, onPress: () => props.onCopy(props.file) },
    ] : []),
    { label: t("files.action.addToFavourites"), icon: "star-outline", onPress: () => mut.favourite.mutate({ workspaceId, fileId: props.file.id }) },
    ...(can("create_share_links") ? [{ label: t("common.action.share"), icon: "share-outline" as const, onPress: () => props.onShare(props.file) }] : []),
    { label: t("files.label.versionHistory"), icon: "time-outline", onPress: () => props.onVersions(props.file) },
    // Ungated: reading and writing a comment is not one of the file permissions,
    // and the API asks only for workspace membership.
    { label: t("files.label.comments"), icon: "chatbubble-ellipses-outline", onPress: () => props.onComments(props.file) },
    ...(offline ? [{ label: offline.label, icon: offline.icon, onPress: offline.onPress }] : []),
    ...(props.canLock ? [{
      label: lockState ? t("files.action.lockLockState", { lockState }) : t("common.action.lock"),
      icon: "lock-closed-outline" as const,
      onPress: () => props.onLock(props.file),
    }] : []),
    ...(props.canHide ? [{
      label: isHidden ? t("files.label.unhideValue", { value: hideState ? ` - ${hideState}` : "" }) : t("files.action.hide"),
      icon: isHidden ? ("eye-outline" as const) : ("eye-off-outline" as const),
      onPress: () => props.onToggleHidden(props.file),
    }] : []),
    ...(canDelete ? [{ label: t("common.delete"), icon: "trash-outline" as const, destructive: true, onPress: () => props.onDelete(props.file) }] : []),
  ];

  return <ActionSheet visible={props.visible} onClose={props.onClose} actions={actions} />;
}
