import { Linking, Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSideloadUpdate } from "./useSideloadUpdate";

/**
 * "Update available" for the sideloaded APK, shown at the foot of Settings.
 *
 * Renders nothing at all on a Play install, on iOS, and whenever the check
 * has not confidently found a newer build - see checkForUpdate. It is the
 * only surface that acts on the check, so an unreachable API is invisible
 * rather than an error the user cannot do anything about.
 *
 * Tapping opens the download page in the browser rather than fetching the APK
 * in-app: installing a package requires REQUEST_INSTALL_PACKAGES, which we
 * deliberately do not hold (see sideloadUpdate.ts).
 */
export function UpdateRow() {
  const t = useT();
  const { tokens } = useColorTheme();
  const update = useSideloadUpdate();

  if (update?.status !== "available") return null;

  return (
    <Pressable
      testID="sideload-update-row"
      accessibilityRole="button"
      accessibilityLabel={t("settings.description.versionVersionIsAvailableOpensTheDownloadPage", { version: update.version })}
      onPress={() => { void Linking.openURL(update.downloadPageUrl).catch(() => {}); }}
      className="mt-4 flex-row items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5"
    >
      <Icon name="arrow-down-circle" size={18} color={tokens.primary} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
          {t("about.label.versionVersionIsAvailable", { version: update.version })}
        </Text>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.label.sizeTapToOpenTheDownloadPage", { size: formatBytes(update.sizeBytes) })}
        </Text>
      </View>
      <Icon name="open-outline" size={16} color={tokens.mutedForeground} />
    </Pressable>
  );
}
