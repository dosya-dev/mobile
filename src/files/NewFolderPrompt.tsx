import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { useFileMutations } from "./mutationHooks";

/**
 * The folder-name prompt, shared by everything that can create a folder.
 *
 * Only mounted while a prompt is open, so `useFileMutations()` stays off the
 * common render path of whatever hosts it. The + sheet is its one caller.
 */
export function NewFolderPrompt({ workspaceId, parentId, onClose }: { workspaceId: string | null; parentId: string | null; onClose: () => void }) {
  const t = useT();
  const mut = useFileMutations();
  return (
    <PromptDialog
      visible
      title={t("files.heading.createNewFolder")}
      // Same wording as web's dialog. POST /api/folders splits the name on "/" and creates
      // each segment in turn, so this works on mobile already - it just wasn't mentioned.
      placeholder={t("files.placeholder.eGBrandAssetsOrProjectsQ2Designs")}
      hint={t("files.description.useToCreateNestedFoldersEGProjectsQ2DesignsCreates3Levels")}
      confirmLabel={t("common.action.create")}
      onCancel={onClose}
      onSubmit={(name) => {
        onClose();
        if (name && workspaceId) mut.createFolder.mutate({ workspaceId, parentId, name }, { onSuccess: () => toast(t("common.label.folderCreated")) });
      }}
    />
  );
}
