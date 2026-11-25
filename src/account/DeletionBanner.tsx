import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { apiRequest } from "@/api/client";
import { useT } from "@/lib/i18n";
import { formatScheduledDate, daysRemaining } from "./deletion";

interface MeResponse {
  user?: { deletion_scheduled_for: number | null };
}

/**
 * Persistent notice while an account deletion is pending.
 *
 * Sits under the workspace header on every tab rather than only on the deletion
 * screen: someone who scheduled a deletion and then forgot should be reminded
 * wherever they are. Two weeks of silence followed by an empty account is the
 * outcome this exists to prevent.
 *
 * Reads the flag off GET /api/me, which the app already calls, so it adds no
 * polling of its own.
 */
export function DeletionBanner() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const { data } = useQuery({
    queryKey: ["me", "deletion"],
    queryFn: () => apiRequest<{ ok: true } & MeResponse>("/api/me"),
    staleTime: 60_000,
  });

  const scheduledFor = data?.user?.deletion_scheduled_for ?? null;
  if (scheduledFor == null) return null;

  const days = daysRemaining(scheduledFor, Math.floor(Date.now() / 1000));

  return (
    <Pressable
      testID="deletion-banner"
      accessibilityRole="button"
      accessibilityLabel={t("common.description.accountScheduledForDeletionTapToCancel")}
      onPress={() => router.push("/delete-account")}
      className="mx-5 mb-2 flex-row items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
    >
      <Icon name="alert-circle" size={16} color={tokens.destructive} />
      <View className="min-w-0 flex-1">
        <Text className="text-xs text-destructive" style={{ fontFamily: fonts.medium }}>
          {t("common.label.deletionScheduledForScheduledDate", { scheduledDate: formatScheduledDate(scheduledFor) })}
        </Text>
        <Text className="text-xs text-destructive">
          {days > 0
            ? t("common.description.daysPluralOneDayOtherDaysLeftTapToCancel", { days })
            : t("common.description.todayTapToCancel")}
        </Text>
      </View>
    </Pressable>
  );
}
