import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { getInboxSummary } from "./api";
import { localDigits } from "@/lib/format-locale";

/** Two digits fit the dot; past that the exact number stops being the point. */
function badgeLabel(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}

export { badgeLabel };

/**
 * Bell plus unread badge, sitting beside the gear and search in the workspace
 * header. Mobile already registers push devices, so a notification could
 * already arrive with nowhere to land; this is the landing place.
 *
 * The count comes from /api/notifications/summary, which is KV-cached
 * server-side, so polling it is cheap. Refetch on focus rather than on an
 * interval: a phone in someone's pocket does not need to poll.
 */
export function NotificationBell() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const { data } = useQuery({
    queryKey: ["notifications", "summary"],
    queryFn: getInboxSummary,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const unread = data?.unread ?? 0;

  return (
    <Pressable
      testID="open-notifications"
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0
          ? t("common.accessibility.notificationsUnreadUnread", { unread: localDigits(unread) })
          : t("common.label.notifications")
      }
      hitSlop={8}
      className="shrink-0"
      onPress={() => router.push("/notifications")}
    >
      <View className="relative">
        <Icon name="notifications-outline" size={22} color={tokens.foreground} />
        {unread > 0 ? (
          <View
            testID="notification-badge"
            className="absolute -end-1.5 -top-1 min-w-4 items-center justify-center rounded-full px-1"
            style={{ backgroundColor: tokens.primary, height: 16 }}
          >
            <Text
              style={{ fontFamily: fonts.bold, fontSize: 9, color: tokens.primaryForeground }}
            >
              {badgeLabel(unread)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
