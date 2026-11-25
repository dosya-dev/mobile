import { Modal, Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { FolderIcon } from "./FolderIcon";
import { formatDate } from "./format";
import type { FolderItem } from "./types";
import { t, useT } from "@/lib/i18n";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <Text className="w-24 shrink-0 text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{label}</Text>
      <Text className="flex-1 text-sm text-foreground" style={{ fontFamily: fonts.regular }}>{value}</Text>
    </View>
  );
}

/** Mirrors web's file-info-dialog folder branch: kind, items, created, status, id. */
function statusOf(folder: FolderItem): string {
  // One message per language for the whole line: the parts and their separators
  // are selects, so no language has to join translated fragments.
  const hasLock = folder.lock_mode === "full_lock" || folder.lock_mode === "view_only";
  const hasHidden = !!folder.is_hidden;
  const isBackup = !!folder.is_synced;
  return t("files.status.normal", {
    normal: String(!hasLock && !hasHidden && !isBackup),
    hasLock: String(hasLock),
    lockMode: folder.lock_mode === "full_lock" ? "full_lock" : "view_only",
    hasHidden: String(hasHidden),
    everyone: String(folder.hidden_mode === "everyone"),
    isBackup: String(isBackup),
  });
}

export function FolderInfoDialog({
  folder,
  visible,
  onClose,
}: {
  folder: FolderItem | null;
  visible: boolean;
  onClose: () => void;
}) {
  useT();
  if (!folder) return null;
  const items = t("common.label.item", { count: folder.file_count });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-8" onPress={onClose} testID="folder-info-backdrop">
        {/* Swallow taps inside the card so they don't close it. */}
        <Pressable className="w-full rounded-xl bg-card p-5" onPress={() => {}}>
          <View className="mb-3 flex-row items-center gap-3">
            <FolderIcon folder={folder} size={36} />
            <View className="min-w-0 flex-1">
              <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.bold }}>{folder.name}</Text>
              <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("files.label.folderItems", { items })}</Text>
            </View>
          </View>
          <Row label={t("files.label.kind")} value={t("common.label.folder")} />
          <Row label={t("files.label.items")} value={items} />
          <Row label={t("common.label.created")} value={formatDate(folder.created_at)} />
          <Row label={t("common.label.status")} value={statusOf(folder)} />
          <Row label={t("files.label.id")} value={folder.id} />
          <Pressable accessibilityRole="button" onPress={onClose} className="mt-4 items-center py-2" testID="folder-info-close">
            <Text className="text-base text-primary" style={{ fontFamily: fonts.medium }}>{t("common.done")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
