import { View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { useOfflineFileState, useOfflineFolderState, type OfflineBadgeState } from "./offlineState";

/**
 * The small mark on a row or tile whose item is kept on this phone. Inline in
 * list rows (beside the lock and link marks), and as a dark bubble on a grid
 * tile's bottom corner, where the top corners already belong to lock and link.
 */
function Badge({ state, id, overlay }: { state: OfflineBadgeState; id: string; overlay?: boolean }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const icon: IconName = state === "saved" ? "arrow-down-circle" : state === "transferring" ? "download-outline" : "time-outline";
  const label =
    state === "saved"
      ? t("offline.label.availableOffline")
      : state === "transferring"
        ? t("offline.label.downloadingForOffline")
        : t("offline.label.offlineUpdatePending");
  const color = overlay ? "#ffffff" : state === "saved" ? tokens.primary : tokens.mutedForeground;
  const glyph = <Icon name={icon} size={overlay ? 12 : 16} color={color} />;
  return (
    <View
      testID={`offline-badge-${id}`}
      accessible
      accessibilityLabel={label}
      className={overlay ? "absolute bottom-1 start-1 rounded-full bg-black/50 p-1" : undefined}
    >
      {glyph}
    </View>
  );
}

export function OfflineFileBadge({ fileId, overlay }: { fileId: string; overlay?: boolean }) {
  const state = useOfflineFileState(fileId);
  return state ? <Badge state={state} id={fileId} overlay={overlay} /> : null;
}

export function OfflineFolderBadge({ folderId, overlay }: { folderId: string; overlay?: boolean }) {
  const state = useOfflineFolderState(folderId);
  return state ? <Badge state={state} id={folderId} overlay={overlay} /> : null;
}
