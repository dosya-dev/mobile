import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { Avatar } from "@/ui/Avatar";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { UsageDataRow } from "@/analytics/UsageDataRow";
import { ShortcutTile } from "@/ui/ShortcutTile";
import { useColorTheme } from "@/theme/useColorTheme";
import { useAppearance } from "@/theme/themeStore";
import { LOCALE_LABELS } from "@/i18n/locales";
import { useAuthStore } from "@/auth/authStore";
import { useMe } from "@/profile/hooks";
import { useEligibility, useStoreStatus } from "@/billing/hooks";
import { storeBillingAvailable } from "@/billing/revenuecat";
import { useSupportChat } from "@/support-chat/store";
import { avatarUrl } from "@/profile/api";
import { WorkspaceHeader } from "@/files/WorkspaceHeader";
import { useBackupSettings } from "@/backup/settings";
import { useWorkspaceDashboard } from "@/workspace-dashboard/api";
import { formatBytes } from "@/lib/format";
import { getDisplayVersion } from "@/lib/appVersion";
import { getCacheSizeBytes, clearCaches } from "@/files/cacheControl";
import { useUploadStore } from "@/upload/store";
import { toast } from "@/ui/toast";
import { UpdateRow } from "@/update/UpdateRow";
import { OfflineSettingsSection } from "@/offline/ui/OfflineSettingsSection";
import { useT, useLocale } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";

// Keys, not text: the label is produced at render so a language switch reaches it.
const MODE_LABEL_KEY = { system: "common.label.system", light: "common.option.light", dark: "common.option.dark" } as const satisfies Record<string, MessageKey>;

/** Places you visit, not things you configure - they render as grid tiles, not rows. */
const SHORTCUTS = [
  { icon: "star", labelKey: "common.label.favourites", route: "/favourites", testID: "settings-favourites" },
  { icon: "share-social-outline", labelKey: "files.label.shares", route: "/shares", testID: "settings-shares" },
  { icon: "trash", labelKey: "common.label.trash", route: "/trash", testID: "settings-trash" },
  { icon: "copy-outline", labelKey: "settings.label.duplicates", route: "/duplicates", testID: "settings-duplicates" },
  { icon: "map-outline", labelKey: "navigation.label.map", route: "/map", testID: "settings-map" },
  { icon: "cloud-upload-outline", labelKey: "search.label.requests", route: "/file-requests", testID: "settings-file-requests" },
  { icon: "albums", labelKey: "settings.label.groups", route: "/groups", testID: "settings-groups" },
  { icon: "people", labelKey: "settings.label.contacts", route: "/contacts", testID: "settings-contacts" },
] as const satisfies readonly { icon: string; labelKey: MessageKey; route: string; testID: string }[];

/**
 * The upgrade / manage-subscription rows. Its own component so the billing queries only
 * mount on builds that can sell through a store.
 */
function StoreBillingRows(props: { planName?: string; onUpgrade: () => void }) {
  const t = useT();
  // Unknown eligibility (loading / error) still shows the row; the paywall itself explains any block.
  const { data: eligibility } = useEligibility();
  const { data: store } = useStoreStatus();
  const showUpgrade = eligibility?.can_purchase !== false;
  if (!showUpgrade && !store) return null;
  return (
    <View className="mb-6 overflow-hidden rounded-lg border border-border bg-card">
      {showUpgrade ? (
        <SettingsRow
          icon="star-outline"
          label={t("upgrade.action.getMoreSpace")}
          value={props.planName}
          border={!!store}
          testID="settings-upgrade"
          onPress={props.onUpgrade}
        />
      ) : null}
      {store ? (
        <SettingsRow
          icon="settings-outline"
          label={t("upgrade.action.manageSubscription")}
          testID="settings-manage-subscription"
          onPress={() => { void Linking.openURL(store.manage_url); }}
        />
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const user = useAuthStore((s) => s.user);
  // Cache size is measured, not tracked: a recursive walk of the cache
  // directory on mount and after each clear. `null` until the first read
  // lands, so the row never shows a number nobody measured.
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const measureCache = useCallback(async () => {
    setCacheBytes(await getCacheSizeBytes());
  }, []);
  useEffect(() => { void measureCache(); }, [measureCache]);
  const onClearCache = async () => {
    if (clearingCache) return;
    const items = useUploadStore.getState().items;
    // Staged uploads live in the cache directory; pulling one out from under a
    // transfer fails it. Say so instead.
    if (items.some((i) => i.status === "queued" || i.status === "uploading")) {
      toast(t("settings.error.anUploadIsInProgressWaitForItToFinishThenClearTheCache"), "error");
      return;
    }
    // An `error` row is still retryable from the dock, and for a file shared in
    // from another app its staged copy is the only copy there is - deleting it
    // would turn "tap to retry" into a dead button. Every unfinished item's uri
    // is spared; one that does not live in the cache simply never matches.
    const keep = new Set(items.filter((i) => i.status !== "done").map((i) => i.uri));
    setClearingCache(true);
    try {
      await clearCaches({ keep });
      toast(t("settings.status.cacheCleared"));
    } finally {
      setClearingCache(false);
      await measureCache();
    }
  };
  const { data: me } = useMe();
  // Live chat: shown only when the server admits this account (paid plan + rollout).
  const chatOn = !!me?.features?.support_chat;
  const chatUnread = useSupportChat((s) => s.unread);
  const refreshChat = useSupportChat((s) => s.refreshSummary);
  // Settings stays mounted as a tab: refresh the count on arrival and on the way back from the chat.
  const chatOpen = useSupportChat((s) => s.chatOpen);
  useEffect(() => { if (chatOn && !chatOpen) void refreshChat(); }, [chatOn, chatOpen, refreshChat]);
  const signOut = useAuthStore((s) => s.signOut);
  const autoBackup = useBackupSettings((s) => s.settings.autoBackup);
  const hydrateBackup = useBackupSettings((s) => s.hydrate);
  const mode = useAppearance((s) => s.mode);
  const { locale, preference } = useLocale();
  const { data: dash } = useWorkspaceDashboard();

  // The Backup value label must reflect what's persisted, not this process's
  // in-memory default - a cold start would otherwise always say "Off".
  useEffect(() => {
    void hydrateBackup();
  }, [hydrateBackup]);

  const total = dash?.total;
  const usedPct =
    total && total.limit_bytes > 0 ? Math.min(100, (total.used_bytes / total.limit_bytes) * 100) : 0;
  // Read from the installed binary, not from app.config.ts: EAS owns the build
  // number remotely, so the config literal is inert. See getDisplayVersion.
  const version = getDisplayVersion();

  return (
    <Screen title={t("settings.heading.settings")} header={<WorkspaceHeader />} aboveTabBar>
      {/* Screen is a plain flex box on purpose - four of its screens own a FlatList, which
          must not be nested in a scroll view - so each screen brings its own scroller. */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* The whole card is the shortcut to Profile. `me` only supplies the photo;
            name/email still come from the auth store so the card fills in before it lands. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.action.openYourProfile")}
          onPress={() => router.push("/profile")}
          testID="settings-account"
          className="mb-6 flex-row items-center gap-3 rounded-lg border border-border bg-card p-4"
        >
          <Avatar
            testID="settings-account-avatar"
            imageUrl={me?.avatar_url ? avatarUrl() : null}
            initials={user?.name || user?.email || "?"}
            color={tokens.muted}
            textColor={tokens.mutedForeground}
            size={44}
            radius={22}
          />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-foreground" numberOfLines={1}>{user?.name ?? ""}</Text>
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>{user?.email ?? ""}</Text>
            {total ? (
              <View testID="settings-usage">
                <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <View className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
                </View>
                <Text className="mt-1 text-xs text-muted-foreground">
                  {t("settings.label.usedOfTotalUsed", { used: formatBytes(total.used_bytes), total: formatBytes(total.limit_bytes) })}
                </Text>
              </View>
            ) : null}
          </View>
          <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />
        </Pressable>

        {storeBillingAvailable() ? <StoreBillingRows planName={me?.plan?.name} onUpgrade={() => router.push("/upgrade")} /> : null}

        <View className="mb-6 flex-row flex-wrap justify-between" style={{ rowGap: 8 }}>
          {SHORTCUTS.map((s) => (
            <ShortcutTile
              key={s.testID}
              icon={s.icon}
              label={t(s.labelKey)}
              testID={s.testID}
              onPress={() => router.push(s.route)}
            />
          ))}
        </View>

        <Section title={t("common.heading.workspace")}>
          <SettingsRow icon="business" label={t("common.action.myWorkspaces")} border testID="settings-workspaces" onPress={() => router.push("/workspaces")} />
          <SettingsRow icon="stats-chart" label={t("settings.action.dashboard")} border testID="settings-workspace-dashboard" onPress={() => router.push("/workspace-dashboard")} />
          <SettingsRow icon="pulse" label={t("settings.action.activity")} testID="settings-activity" onPress={() => router.push("/activity")} />
        </Section>

        <Section title={t("settings.heading.storage")}>
          <SettingsRow
            icon="lock-closed-outline"
            label="Vault"
            description={t("settings.label.endToEndEncryptedSpaces")}
            border
            testID="settings-vault"
            onPress={() => router.push("/vault")}
          />
          <SettingsRow
            icon="server-outline"
            label={t("settings.action.storageUsedByCache")}
            description={t("settings.description.thumbnailsOpenedFilesAndTemporaryCopiesSafeToClear")}
            value={cacheBytes == null ? undefined : formatBytes(cacheBytes)}
            testID="settings-cache-size"
            right={
              <Pressable
                testID="settings-clear-cache"
                accessibilityRole="button"
                disabled={clearingCache}
                onPress={() => { void onClearCache(); }}
                className="ms-2 rounded-lg bg-secondary px-3 py-1.5"
              >
                <Text className="text-sm text-foreground">{clearingCache ? t("settings.status.clearing") : t("common.action.clear")}</Text>
              </Pressable>
            }
          />
        </Section>

        {/* Not part of the cache row above: Clear cache never removes offline files. */}
        <OfflineSettingsSection />

        <Section title={t("settings.heading.preferences")}>
          <SettingsRow icon="cloud-upload" label={t("settings.action.backup")} value={autoBackup ? t("about.status.on") : t("common.status.off")} border testID="settings-backup" onPress={() => router.push("/backup-settings")} />
          <SettingsRow icon="notifications-outline" label={t("settings.action.notifications")} border testID="settings-notifications" onPress={() => router.push("/notification-settings")} />
          <SettingsRow icon="contrast" label={t("common.action.appearance")} value={t(MODE_LABEL_KEY[mode])} border testID="settings-appearance" onPress={() => router.push("/appearance")} />
          <SettingsRow
            icon="globe-outline"
            label={t("appearance.label.language")}
            value={preference === "device" ? t("appearance.option.deviceLanguage") : LOCALE_LABELS[locale]}
            border
            testID="settings-language"
            onPress={() => router.push("/language")}
          />
          {/* For when the TV's QR code is not scanned: type the code shown on the TV. */}
          <SettingsRow icon="tv-outline" label={t("tv.heading.signInOnATv")} border testID="settings-tv" onPress={() => router.push("/tv")} />
          <SettingsRow icon="shield-checkmark-outline" label={t("settings.action.security")} description={t("settings.label.password2FABiometricUnlock")} border={chatOn} testID="settings-security" onPress={() => router.push("/security")} />
          {chatOn ? (
            <SettingsRow
              icon="chatbubble-ellipses-outline"
              label={t("common.action.liveChat")}
              description={chatUnread > 0 ? undefined : t("support-chat.status.onlineUsuallyRepliesInAFewMinutes")}
              right={chatUnread > 0 ? <UnreadBadge count={chatUnread} /> : undefined}
              testID="settings-live-chat"
              onPress={() => router.push("/support-chat")}
            />
          ) : null}
        </Section>

        {/* Device-wide and kept across sign-out: usage data is on unless it
            is switched off here (src/analytics/analytics.ts). */}
        <Section>
          <UsageDataRow />
        </Section>

        <Button title={t("common.action.signOut")} variant="ghost" onPress={() => { void signOut(); }} testID="signout" />
        {/* Sideloaded Android builds only; renders null everywhere else. */}
        <UpdateRow />
        {version ? (
          <Text testID="settings-version" className="mt-2 text-center text-xs text-muted-foreground">{t("settings.label.versionVersion", { version })}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Unseen live chat replies, as a red count at the end of the Live chat row. */
function UnreadBadge({ count }: { count: number }) {
  const t = useT();
  return (
    <View
      testID="settings-live-chat-unread"
      accessibilityLabel={t("support-chat.label.unreadCount", { count })}
      className="min-w-[20px] items-center rounded-full bg-destructive px-1.5"
    >
      <Text className="text-xs leading-5 text-destructive-foreground">{count > 99 ? "99+" : count}</Text>
    </View>
  );
}
