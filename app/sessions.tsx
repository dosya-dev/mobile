import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Stack } from "expo-router";
import { Icon, type IconName } from "@/ui/Icon";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSessions, SESSIONS_KEY } from "@/profile/hooks";
import { revokeSession, revokeAllOtherSessions } from "@/profile/api";
import type { DeviceSession } from "@/profile/types";

function errMessage(e: unknown, t: T): string {
  return e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain");
}

function iconFor(kind: DeviceSession["kind"]): IconName {
  if (kind === "mobile") return "phone-portrait";
  if (kind === "tablet") return "tablet-portrait";
  return "desktop";
}

export default function SessionsScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useSessions();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const others = (data ?? []).filter((s) => !s.is_current).length;

  const revokeOne = async (s: DeviceSession) => {
    setBusy(true);
    try {
      await revokeSession(s.id);
      await qc.invalidateQueries({ queryKey: SESSIONS_KEY });
      toast(t("sessions.status.deviceSignedOut"));
    } catch (e) {
      toast(errMessage(e, t), "error");
    }
    setBusy(false);
  };

  const revokeAll = async () => {
    setConfirmAll(false);
    setBusy(true);
    try {
      await revokeAllOtherSessions();
      await qc.invalidateQueries({ queryKey: SESSIONS_KEY });
      toast(t("sessions.status.signedOutEverywhereElse"));
    } catch (e) {
      toast(errMessage(e, t), "error");
    }
    setBusy(false);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("profile.heading.sessions") }} />
      <Screen underNativeHeader title={t("profile.heading.sessions")}>
        {isLoading ? (
          <View testID="sessions-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("sessions.error.couldnTLoadSessions")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <>
            <Text className="mb-3 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("sessions.description.devicesSignedInToYourAccountIncludingThisApp")}
            </Text>
            <View className="overflow-hidden rounded-lg border border-border bg-card">
              <FlatList
                data={data ?? []}
                keyExtractor={(s) => s.id}
                refreshing={isRefetching}
                onRefresh={() => refetch()}
                renderItem={({ item, index }) => (
                  <View
                    testID={`session-${item.id}`}
                    className={
                      "flex-row items-center gap-3 px-4 py-3" +
                      (index < (data?.length ?? 0) - 1 ? " border-b border-border" : "")
                    }
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-lg bg-muted">
                      <Icon name={iconFor(item.kind)} size={18} color={tokens.mutedForeground} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-sm text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
                          {item.device}
                        </Text>
                        {item.is_current ? <Badge label={t("sessions.label.thisDevice")} /> : null}
                      </View>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
                        {item.meta}
                      </Text>
                    </View>
                    {!item.is_current ? (
                      <Pressable
                        testID={`revoke-${item.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t("sessions.action.signOutDevice", { device: item.device })}
                        hitSlop={8}
                        disabled={busy}
                        onPress={() => revokeOne(item)}
                      >
                        <Icon name="log-out-outline" size={20} color={tokens.destructive} />
                      </Pressable>
                    ) : null}
                  </View>
                )}
              />
            </View>

            {others > 0 ? (
              <View className="mt-4">
                <Button title={t("sessions.action.signOutAllOtherDevices")} testID="revoke-all" variant="ghost" onPress={() => setConfirmAll(true)} loading={busy} />
              </View>
            ) : null}
          </>
        )}

        <ConfirmDialog
          visible={confirmAll}
          title={t("sessions.heading.signOutEverywhereElse")}
          message={t("sessions.description.othersOtherDeviceOthersPluralOneOtherSWillBeSignedOutThisDevice", { others })}
          confirmLabel={t("common.action.signOut")}
          destructive
          onConfirm={revokeAll}
          onCancel={() => setConfirmAll(false)}
        />
      </Screen>
    </>
  );
}
