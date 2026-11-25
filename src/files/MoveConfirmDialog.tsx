import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import type { MoveItems } from "./dragMove";

/** Where a drop lands: a folder in the listing, or the workspace root (`id: null`). */
export interface MoveTarget {
  id: string | null;
  name: string;
}

/**
 * The sentence the confirm shows, with web's four variants: one named item,
 * N files, N folders, or N files and M folders. A single item whose name is
 * not in the listing any more falls back to the count.
 */
export function moveConfirmMessage(
  items: MoveItems,
  folder: string,
  nameOf: (kind: "file" | "folder", id: string) => string | null,
  t: T,
): string {
  const files = items.fileIds.length;
  const folders = items.folderIds.length;
  if (files + folders === 1) {
    const name = files === 1 ? nameOf("file", items.fileIds[0]) : nameOf("folder", items.folderIds[0]);
    if (name) return t("files.description.youAreMovingNameToFolder", { name, folder });
  }
  if (files > 0 && folders > 0) return t("files.description.youAreMovingFilesAndFoldersToFolder", { files, folders, folder });
  if (files > 0) return t("files.description.youAreMovingFilesToFolder", { files, folder });
  return t("files.description.youAreMovingFoldersToFolder", { folders, folder });
}

/**
 * "Are you sure?" after a drop. Nothing moves on the drop itself; Move here
 * runs the same bulk move as the destination picker. Same title, body and
 * buttons as the web page's drop dialog.
 */
export function MoveConfirmDialog(props: {
  visible: boolean;
  items: MoveItems;
  target: MoveTarget;
  nameOf: (kind: "file" | "folder", id: string) => string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <ConfirmDialog
      visible={props.visible}
      title={t("common.heading.areYouSure")}
      message={moveConfirmMessage(props.items, props.target.name, props.nameOf, t)}
      confirmLabel={t("files.action.move")}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}
