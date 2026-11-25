import { useState } from "react";
import { ActivityIndicator, ScrollView, Switch, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { t as moduleT, useT } from "@/lib/i18n";
import {
  getNotificationSettings, setNotificationPreference, setNotificationChannel,
} from "@/notifications/api";
import { CHANNELS, type NotificationChannel } from "@/notifications/groups";
import { registerForPush, unregisterForPush } from "@/notifications/push";

const KEY = ["notification-settings"] as const;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : moduleT("common.error.couldnTSaveTryAgain");
}

export default function NotificationSettingsScreen() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: getNotificationSettings });
  // Optimistic local overlay: the switch must move under the finger, then reconcile.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const toggle = async (
    key: string,
    next: boolean,
    save: () => Promise<void>,
    after?: (v: boolean) => Promise<void>,
  ) => {
    setPending((p) => ({ ...p, [key]: next }));
    try {
      await save();
      await after?.(next);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setPending((p) => {
        const { [key]: _drop, ...rest } = p;
        return rest;
      });
      toast(errMessage(e), "error");
    }
  };

  const onChannel = (key: NotificationChannel, next: boolean) =>
    toggle(`ch:${key}`, next, () => setNotificationChannel(key, next), async (v) => {
      if (key !== "push") return;
      // Turning the channel on is also when we ask the OS and register this device.
      if (v) {
        const res = await registerForPush();
        if (res.kind === "denied") toast(t("notification-settings.error.enableNotificationsForDosyaDevInSettings"), "error");
        else if (res.kind === "unsupported") toast(res.reason, "error");
      } else {
        await unregisterForPush();
      }
    });

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("notification-settings.heading.notificationSettings") }} />
      <Screen underNativeHeader title={t("notification-settings.heading.notificationSettings")}>
        {isLoading ? (
          <View testID="notif-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError || !data ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("notification-settings.error.couldnTLoadNotificationSettings")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Section title={t("notification-settings.heading.delivery")}>
              {CHANNELS.map((c, i) => (
                <View
                  key={c.key}
                  className={"flex-row items-center gap-3 px-4 py-3" + (i < CHANNELS.length - 1 ? " border-b border-border" : "")}
                >
                  <View className="flex-1">
                    <Text className="text-base text-foreground" style={{ fontFamily: fonts.regular }}>{t(c.labelKey)}</Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t(c.descKey)}</Text>
                  </View>
                  <Switch
                    testID={`channel-${c.key}`}
                    value={pending[`ch:${c.key}`] ?? data.channels[c.key] ?? true}
                    onValueChange={(v) => onChannel(c.key, v)}
                  />
                </View>
              ))}
            </Section>

            {/* Delivery is gated on In-app server-side: with it off, nothing is created
                and nothing is pushed. Say so rather than let the other switches lie. */}
            {(pending["ch:in_app"] ?? data.channels.in_app) === false ? (
              <View className="-mt-3 mb-6 px-1" testID="in-app-warning">
                <Text className="text-xs text-destructive" style={{ fontFamily: fonts.regular }}>
                  {t("notification-settings.description.withInAppOffNoNotificationsAreDeliveredAtAllEmailAndPushIncluded")}
                </Text>
              </View>
            ) : null}

            {/* One row per group, described by the server. This app used to
                declare its own list of 22 legacy type keys - see groups.ts. */}
            <Section title={t("notification-settings.heading.whatYouHearAbout")}>
              {data.groups.map((g, i) => {
                const on = pending[g.key] ?? g.enabled;
                return (
                  <View key={g.key} testID={`notif-group-${g.key}`}>
                    <View
                      className={"flex-row items-center gap-3 px-4 py-3"
                        + (g.options.length > 0 || i < data.groups.length - 1 ? " border-b border-border" : "")}
                    >
                      <View className="flex-1">
                        <Text className="text-sm text-foreground" style={{ fontFamily: fonts.regular }}>{g.label}</Text>
                        <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{g.description}</Text>
                        {g.note ? (
                          <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{g.note}</Text>
                        ) : null}
                      </View>
                      {g.alwaysOn === "all" ? (
                        <Text testID={`always-on-${g.key}`} className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                          {t("notification-settings.status.alwaysOn")}
                        </Text>
                      ) : (
                        <Switch
                          testID={`pref-${g.key}`}
                          value={on}
                          onValueChange={(v) => toggle(g.key, v, () => setNotificationPreference(g.key, v))}
                        />
                      )}
                    </View>
                    {g.options.map((o, j) => (
                      <View
                        key={o.key}
                        className={"flex-row items-center gap-3 py-3 ps-8 pe-4"
                          + (j < g.options.length - 1 || i < data.groups.length - 1 ? " border-b border-border" : "")}
                      >
                        <View className="flex-1">
                          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.regular }}>{o.label}</Text>
                          <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{o.description}</Text>
                        </View>
                        {/* A sub-switch under a muted group can only lie: the
                            group gate runs first, whatever this one says. */}
                        <Switch
                          testID={`pref-${o.key}`}
                          disabled={!on}
                          value={pending[o.key] ?? o.enabled}
                          onValueChange={(v) => toggle(o.key, v, () => setNotificationPreference(o.key, v))}
                        />
                      </View>
                    ))}
                  </View>
                );
              })}
            </Section>
          </ScrollView>
        )}
      </Screen>
    </>
  );
}
