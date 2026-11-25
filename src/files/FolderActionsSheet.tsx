import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { usePermissions } from "@/workspace/usePermissions";
import type { FolderItem } from "./types";
import { useT } from "@/lib/i18n";
import { useWorkspaceStore } from "./workspaceStore";
import { useOfflineRow } from "@/offline/ui/offlineActions";

/**
 * Mirrors web's folder context menu, in web's order: open/info, then the edit actions,
 * then lock/hide, then delete. Lock and Hide take their label from the folder's current
 * state, as web does.
 *
 * Every entry is gated on the permission its endpoint actually checks. This
 * sheet used to offer all of it to every role - a viewer got Rename, Move,
 * Lock, Hide and Delete and found out what their role was from a row of 403
 * toasts. `canLock` / `canHide` come from the /api/files payload's can_lock and
 * can_hide, which the server has always sent and no client had ever read.
 */
export function FolderActionsSheet({
  folder,
  visible,
  onClose,
  onOpen,
  onInfo,
  onRename,
  onMove,
  onAddToGroup,
  onShare,
  onLock,
  onToggleHidden,
  onDelete,
  onSelect,
  canLock = false,
  canHide = false,
}: {
  folder: FolderItem;
  visible: boolean;
  onClose: () => void;
  onOpen: (folder: FolderItem) => void;
  onInfo: (folder: FolderItem) => void;
  /** Starts selection mode with this folder ticked. Absent where the role can move nothing. */
  onSelect?: (folder: FolderItem) => void;
  onRename: (folder: FolderItem) => void;
  onMove: (folder: FolderItem) => void;
  onAddToGroup: (folder: FolderItem) => void;
  onShare: (folder: FolderItem) => void;
  onLock: (folder: FolderItem) => void;
  onToggleHidden: (folder: FolderItem) => void;
  onDelete: (folder: FolderItem) => void;
  /** From the listing's can_lock / can_hide. Default false: fail closed. */
  canLock?: boolean;
  canHide?: boolean;
}) {
  const t = useT();
  const { can } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  // Make available offline / Remove from offline; null when canPin refuses.
  // A large folder asks first, in OfflinePinConfirm (hosted by the screen).
  const offline = useOfflineRow({ kind: "folder", item: folder }, workspaceId);

  const actions: SheetAction[] = [
    { label: t("files.open"), icon: "folder-open-outline", onPress: () => onOpen(folder) },
    { label: t("files.action.getInfo"), icon: "information-circle-outline", onPress: () => onInfo(folder) },
    ...(onSelect ? [{ label: t("files.action.select"), icon: "checkmark-circle-outline" as const, onPress: () => onSelect(folder) }] : []),
    ...(can("rename_folders") ? [
      { label: t("common.action.rename"), icon: "create-outline" as const, onPress: () => onRename(folder) },
      { label: t("files.action.moveTo"), icon: "arrow-forward-outline" as const, onPress: () => onMove(folder) },
    ] : []),
    { label: t("common.action.addToGroup"), icon: "albums-outline", onPress: () => onAddToGroup(folder) },
    ...(offline ? [{ label: offline.label, icon: offline.icon, onPress: offline.onPress }] : []),
    // Folder sharing has existed on mobile - the route, the API call and the
    // mutation were all here - with nothing anywhere in the UI that reached it.
    // Gated on the same permission the file sheet uses for Share.
    ...(can("create_share_links")
      ? [{ label: t("common.action.share"), icon: "share-outline" as const, onPress: () => onShare(folder) }]
      : []),
    ...(canLock ? [{
      label: folder.lock_mode !== "none" ? t("common.action.unlock") : t("common.action.lock"),
      icon: folder.lock_mode !== "none" ? ("lock-open-outline" as const) : ("lock-closed-outline" as const),
      onPress: () => onLock(folder),
    }] : []),
    ...(canHide ? [{
      label: folder.is_hidden ? t("files.action.unhide") : t("files.action.hide"),
      icon: folder.is_hidden ? ("eye-outline" as const) : ("eye-off-outline" as const),
      onPress: () => onToggleHidden(folder),
    }] : []),
    ...(can("delete_any_file") || can("delete_own_files")
      ? [{ label: t("common.delete"), icon: "trash-outline" as const, destructive: true, onPress: () => onDelete(folder) }]
      : []),
  ];
  return <ActionSheet visible={visible} onClose={onClose} actions={actions} />;
}
