import { Pressable, Text, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { useT } from "@/lib/i18n";
import type { StagePalette } from "@/viewer/stageTheme";

/**
 * The two notes a file opened from its saved offline copy can carry when the
 * server holds a newer version (the plan's "Viewer behaviour" table).
 *
 * The saved copy always stays on screen. Online, from Files, the bar offers the
 * newer one for this view only; offline, or from the Offline screen, the note
 * only says an update is waiting - nothing is fetched on the user's behalf.
 */

export function NewerVersionBar({ palette, onOpenNewer }: { palette: StagePalette; onOpenNewer: () => void }) {
  const t = useT();
  return (
    <View
      testID="viewer-newer-version-bar"
      className="absolute inset-x-0 top-0 z-10 flex-row items-center justify-center gap-2 px-3 py-1.5"
      style={{ backgroundColor: palette.chrome }}
    >
      <Icon name="download-outline" size={12} color={palette.fg} />
      <Text className="text-[11px]" style={{ color: palette.fg }}>{t("offline.label.aNewerVersionIsOnDosya")}</Text>
      <Pressable
        testID="viewer-open-newer-version"
        accessibilityRole="button"
        onPress={onOpenNewer}
        hitSlop={8}
      >
        <Text className="text-[11px] font-bold underline" style={{ color: palette.fg }}>{t("offline.action.openNewerVersion")}</Text>
      </Pressable>
    </View>
  );
}

export function UpdatePendingNote({ palette }: { palette: StagePalette }) {
  const t = useT();
  return (
    <View
      testID="viewer-update-pending"
      className="absolute inset-x-0 top-0 z-10 flex-row items-center justify-center gap-1.5 px-3 py-1.5"
      style={{ backgroundColor: palette.chrome }}
      pointerEvents="none"
    >
      <Icon name="time-outline" size={12} color={palette.fg} />
      <Text className="text-[11px]" style={{ color: palette.fg }}>{t("offline.label.savedVersionUpdatePending")}</Text>
    </View>
  );
}
