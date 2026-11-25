import { View } from "react-native";
import { Icon } from "@/ui/Icon";
import { useBackupRun } from "@/backup/runState";
import { useUploadStore } from "@/upload/store";
import { useColorTheme } from "@/theme/useColorTheme";

/**
 * The Backup tab's icon, live: while a run is active (scanning or backup
 * uploads in flight) it tints primary and grows a corner dot, so the engine's
 * activity is visible from any tab. Static - the OS tab bar is no place for
 * an animation loop.
 */
export function BackupTabIcon({ color, size }: { color: string; size: number }) {
  const { tokens } = useColorTheme();
  const phase = useBackupRun((s) => s.phase);
  const hasActive = useUploadStore((s) =>
    s.items.some((i) => i.id.startsWith("bk_") && (i.status === "uploading" || i.status === "queued")),
  );
  const active = phase !== "idle" || hasActive;
  return (
    <View testID="backup-tab-icon">
      <Icon name="cloud-upload" color={active ? tokens.primary : color} size={size} />
      {active ? (
        <View
          testID="backup-tab-active-dot"
          className="absolute -end-1 -top-0.5 h-2.5 w-2.5 rounded-full border border-card bg-primary"
        />
      ) : null}
    </View>
  );
}
