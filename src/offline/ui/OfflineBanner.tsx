import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { useIsOnline } from "../network";
import { useOfflineStore } from "../offlineStore";

/**
 * The line over the file list while the phone has no connection. Only when we
 * KNOW it is offline (false, not null): an unknown connection is not news.
 * With pins, it links to the Offline screen, where everything saved opens.
 */
export function OfflineBanner() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const online = useIsOnline();
  const hasPins = useOfflineStore((s) => s.pins.length > 0);
  if (online !== false) return null;
  return (
    <View
      testID="offline-banner"
      accessibilityRole="summary"
      className="mx-5 mb-2 flex-row items-center gap-2 rounded-lg bg-secondary px-3 py-2"
    >
      <Icon name="cloud-offline-outline" size={16} color={tokens.mutedForeground} />
      <Text className="flex-1 text-xs text-foreground" style={{ fontFamily: fonts.regular }}>
        {t("offline.label.youReOfflinePinnedFilesStillOpen")}
      </Text>
      {hasPins ? (
        <Pressable
          testID="offline-banner-open"
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => router.push("/offline")}
        >
          <Text className="text-xs" style={{ color: tokens.primary, fontFamily: fonts.medium }}>
            {t("offline.action.seeOfflineFiles")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
