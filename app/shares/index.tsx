import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, Share, TextInput, View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import * as Clipboard from "expo-clipboard";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces } from "@/files/hooks";
import { useMyShares, useShareMutations, useSharedWithMe } from "@/share/hooks";
import { shareUrl } from "@/share/config";
import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { avatarColor, avatarLabel, badgesFor, expiryLabel, statusTone } from "@/share/format";
import { Segmented } from "@/share/controls";
import { timeAgo } from "@/files/workspace-format";
import type { MyShare, ShareStatus, SharedWithMe } from "@/share/types";
import { rtlLine, useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { localDigits } from "@/lib/format-locale";
import { inputStartAlign } from "@/lib/direction";

/**
 * The links this workspace has out in the world.
 *
 * The screen this replaces was a flat list of names and view counts. It could
 * not answer the question people actually open it with - what is still live,
 * and what stops working this week - because it showed no status, had no
 * filters, and dropped the `stats` block the endpoint has always returned.
 */

type Filter = "all" | ShareStatus;

// Holds keys, not text: the label is looked up when the chip renders.
const FILTERS: { key: Filter; label: MessageKey }[] = [
  { key: "all", label: "common.label.all" },
  { key: "active", label: "shared-links.label.active" },
  { key: "expiring", label: "shared-links.label.expiring" },
  { key: "expired", label: "shared-links.label.expired" },
  { key: "revoked", label: "shared-links.label.revoked" },
];

/** Row-level status colour. Semantic, and deliberately not the theme accent. */
const TONE_COLOR = {
  live: "#17a34a",
  warn: "#e08c17",
  dead: "#94a3b0",
  revoked: "#e0424c",
} as const;

export default function MySharesScreen() {
  const { tokens } = useColorTheme();
  const t = useT();
  const router = useRouter();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const q = useMyShares(ws);
  const withMe = useSharedWithMe();
  const { revoke } = useShareMutations();

  const [tab, setTab] = useState<"by-me" | "with-me">("by-me");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sheetFor, setSheetFor] = useState<MyShare | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<MyShare | null>(null);

  // Memoised because it is the useMemo dependency below: `?? []` builds a new
  // array on every render, which made the filter+search pass re-run each time
  // regardless of whether anything had actually changed.
  const links = useMemo(() => q.data?.links ?? [], [q.data?.links]);
  const stats = q.data?.stats;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return links
      .filter((l) => filter === "all" || l.status === filter)
      .filter((l) => !needle
        || l.display_name.toLowerCase().includes(needle)
        || (l.sharer_name ?? "").toLowerCase().includes(needle));
  }, [links, filter, search]);

  const expiringCount = stats?.expiring ?? 0;

  const sharedWithMeLabel = (): string => {
    const n = withMe.data?.links.length ?? 0;
    return t("shared-links.label.sharedWithMeHasCountSelectTrueCountOther", { hasCount: String(n > 0), count: localDigits(n) });
  };

  const copyLink = async (link: MyShare) => {
    await Clipboard.setStringAsync(link.url || shareUrl(link.token));
    toast(t("common.label.linkCopied"));
  };

  const actionsFor = (link: MyShare): SheetAction[] => {
    const url = link.url || shareUrl(link.token);
    const live = link.status === "active" || link.status === "expiring";
    const actions: SheetAction[] = [
      { label: t("shared-links.action.openDetails"), icon: "stats-chart-outline", onPress: () => router.push(`/shares/${link.link_id}`) },
    ];
    if (live) {
      actions.push(
        { label: t("common.action.copyLink"), icon: "copy-outline", onPress: () => void copyLink(link) },
        { label: t("shared-links.action.shareLink"), icon: "share-outline", onPress: () => void Share.share({ message: url }) },
        { label: t("files.action.revokeLink"), icon: "trash-outline", destructive: true, onPress: () => setRevokeTarget(link) },
      );
    }
    return actions;
  };

  if (tab === "with-me") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: true, title: t("shared-links.heading.shares") }} />
        <View className="px-5 pt-3">
          <Segmented
            testID="shares-tab"
            value={tab}
            onChange={(k) => setTab(k as "by-me" | "with-me")}
            options={[
              { key: "by-me", label: t("shared-links.label.sharedByMe") },
              { key: "with-me", label: sharedWithMeLabel() },
            ]}
          />
        </View>
        <WithMeList query={withMe} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("shared-links.heading.shares") }} />

      <FlatList
        data={visible}
        keyExtractor={(s) => s.link_id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={tokens.mutedForeground} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View className="px-5 pt-3">
            <View className="mb-3">
              <Segmented
                testID="shares-tab"
                value={tab}
                onChange={(k) => setTab(k as "by-me" | "with-me")}
                options={[
                  { key: "by-me", label: t("shared-links.label.sharedByMe") },
                  { key: "with-me", label: sharedWithMeLabel() },
                ]}
              />
            </View>
            <View className="mb-3 flex-row items-center gap-2 rounded-xl bg-muted px-3">
              <Icon name="search" size={15} color={tokens.mutedForeground} />
              <TextInput
                testID="share-search"
                value={search}
                onChangeText={setSearch}
                placeholder={t("shared-links.placeholder.filterByNameOrPerson")}
                placeholderTextColor={tokens.mutedForeground}
                className="flex-1 py-2.5 text-foreground"
                style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
              />
              {search ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t("common.action.clearSearch")} hitSlop={8} testID="clear-search" onPress={() => setSearch("")}>
                  <Icon name="close-circle" size={15} color={tokens.mutedForeground} />
                </Pressable>
              ) : null}
            </View>

            {/* The four numbers the endpoint has always returned and no mobile
                screen ever read. */}
            {stats ? (
              <View className="mb-3 flex-row overflow-hidden rounded-xl border border-border">
                {[
                  { id: "active", value: stats.active, label: t("shared-links.label.active"), attn: false },
                  { id: "views", value: stats.total_views, label: t("shared-links.label.views"), attn: false },
                  { id: "expiring", value: stats.expiring, label: t("shared-links.label.expiring"), attn: stats.expiring > 0 },
                  { id: "total", value: stats.total, label: t("common.label.total"), attn: false },
                ].map((s, i) => (
                  <View
                    key={s.id}
                    className={"flex-1 bg-card px-2 py-2.5" + (i > 0 ? " border-border" : "")}
                    style={i > 0 ? { borderStartWidth: 1 } : undefined}
                  >
                    <Text
                      className={"text-lg " + (s.attn ? "text-amber-600" : "text-foreground")}
                      style={{ fontFamily: fonts.bold }}
                      testID={`stat-${s.id}`}
                    >
                      {s.value}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">{s.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View className="mb-1 flex-row flex-wrap gap-2">
              {FILTERS.map((f) => {
                const on = filter === f.key;
                const warn = f.key === "expiring" && expiringCount > 0;
                return (
                  <Pressable
                    key={f.key}
                    testID={`filter-${f.key}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setFilter(f.key)}
                    className={
                      "rounded-full border px-3 py-1.5 " +
                      (on ? "border-primary bg-primary" : warn ? "border-amber-500/50 bg-transparent" : "border-border bg-transparent")
                    }
                  >
                    <Text
                      className={"text-xs " + (on ? "text-primary-foreground" : warn ? "text-amber-600" : "text-muted-foreground")}
                      style={{ fontFamily: on ? fonts.bold : fonts.regular }}
                    >
                      {t(f.label)}{warn && !on ? ` · ${expiringCount}` : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ShareRow
            link={item}
            onPress={() => router.push(`/shares/${item.link_id}`)}
            onLongPress={() => setSheetFor(item)}
            onCopy={() => void copyLink(item)}
            onRevoke={() => setRevokeTarget(item)}
          />
        )}
        ListEmptyComponent={
          q.isLoading ? null : (
            <View className="items-center px-10 pt-16">
              <Icon name="link-outline" size={30} color={tokens.mutedForeground} />
              <Text className="mt-3 text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>
                {links.length === 0 ? t("shared-links.label.nothingSharedYet") : t("shared-links.label.noLinksWithThisStatus")}
              </Text>
              <Text className="mt-1 text-center text-xs text-muted-foreground">
                {links.length === 0
                  ? t("shared-links.description.aShareLinkLetsSomeoneOpenAFileWithoutADosyaAccountShareA")
                  : t("shared-links.description.tryADifferentFilter")}
              </Text>
            </View>
          )
        }
      />

      <ActionSheet visible={!!sheetFor} onClose={() => setSheetFor(null)} actions={sheetFor ? actionsFor(sheetFor) : []} />

      <ConfirmDialog
        visible={!!revokeTarget}
        title={t("shared-links.heading.revokeThisLink")}
        message={
          revokeTarget
            ? t("shared-links.description.anyoneHoldingTheLinkToDisplayNameLosesAccessImmediatelyThisCannotBeUndone", { displayName: revokeTarget.display_name })
            : undefined
        }
        confirmLabel={t("common.action.revoke")}
        destructive
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget.link_id);
          setRevokeTarget(null);
        }}
      />
    </SafeAreaView>
  );
}

function ShareRow({ link, onPress, onLongPress, onCopy, onRevoke }: {
  link: MyShare;
  onPress: () => void;
  onLongPress: () => void;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const { tokens } = useColorTheme();
  const t = useT();
  const tone = statusTone(link.status);
  const badges = badgesFor(link);
  const dead = link.status === "revoked" || link.status === "expired";
  const live = link.status === "active" || link.status === "expiring";

  return (
    <Pressable
      testID={`share-row-${link.link_id}`}
      accessibilityRole="button"
      accessibilityLabel={`${link.display_name}, ${expiryLabel(link)}`}
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-row items-center gap-3 border-b border-border px-5 py-3"
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: dead ? tokens.muted : avatarColor(link.display_name) }}
      >
        {link.is_folder ? (
          <Icon name="folder" size={16} color={dead ? tokens.mutedForeground : "#fff"} />
        ) : (
          <Text
            className="text-[8px]"
            style={{ fontFamily: fonts.bold, color: dead ? tokens.mutedForeground : "#fff" }}
          >
            {avatarLabel(link.display_name, link.extension)}
          </Text>
        )}
      </View>

      <View className="flex-1">
        <Text
          className={"text-sm " + (dead ? "text-muted-foreground" : "text-foreground")}
          style={{ fontFamily: fonts.medium }}
          numberOfLines={1}
        >
          {link.display_name}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1.5">
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_COLOR[tone] }} />
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
            {expiryLabel(link)}
            {!link.is_mine && link.sharer_name ? ` ${t("shared-links.label.bySharerName", { sharerName: link.sharer_name })}` : ""}
          </Text>
          {badges.map((b) => (
            <View key={b.key} className="flex-row items-center gap-0.5" accessibilityLabel={b.label}>
              <Icon name={b.icon as never} size={10} color={tokens.mutedForeground} />
              {b.count ? <Text className="text-[10px] text-muted-foreground">{b.count}</Text> : null}
            </View>
          ))}
        </View>
      </View>

      <View className="items-end">
        <Text className="text-sm text-foreground" style={{ fontFamily: fonts.bold }}>{link.view_count}</Text>
        <Text className="text-[10px] text-muted-foreground">{t("shared-links.label.downloadcountDl", { downloadCount: link.download_count })}</Text>
      </View>

      {live ? (
        <View className="flex-row gap-3 ps-1">
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.action.copyLink")} hitSlop={8} onPress={onCopy} testID={`copy-${link.link_id}`}>
            <Icon name="copy-outline" size={18} color={tokens.mutedForeground} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("shared-links.action.revokeShare")} hitSlop={8} onPress={onRevoke} testID={`revoke-${link.link_id}`}>
            <Icon name="trash-outline" size={18} color={tokens.destructive} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Private links other people sent to this address.
 *
 * A separate list from the one above rather than a mode of it: a recipient gets
 * no view or download counts (those are the sender's analytics about everyone
 * they shared with) and no revoke, because it is not their link. What they need
 * is who sent it, whether they have opened it, and how long it lasts.
 */
function WithMeList({ query }: { query: ReturnType<typeof useSharedWithMe> }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const page = query.data;

  if (query.isLoading) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>;
  }

  // Not an empty state: the list is empty BY RULE until the address is
  // confirmed, and saying "nothing here" would read as "nobody sent you
  // anything".
  if (page && !page.emailVerified) {
    return (
      <View className="flex-1 items-center px-10 pt-16">
        <Icon name="mail-unread-outline" size={30} color={tokens.mutedForeground} />
        <Text className="mt-3 text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>
          {t("shared-links.label.verifyYourEmailToSeeThese")}
        </Text>
        <Text className="mt-1 text-center text-xs text-muted-foreground">
          {t("shared-links.description.privateLinksAreMatchedToYourAddressSoWeOnlyListThemOnceThat")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={page?.links ?? []}
      keyExtractor={(l) => l.link_id}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={tokens.mutedForeground} />}
      contentContainerStyle={{ paddingBottom: 32, paddingTop: 8 }}
      renderItem={({ item }) => <WithMeRow link={item} />}
      ListEmptyComponent={
        <View className="items-center px-10 pt-16">
          <Icon name="people-outline" size={30} color={tokens.mutedForeground} />
          <Text className="mt-3 text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>
            {t("shared-links.label.nothingSharedWithYou")}
          </Text>
          <Text className="mt-1 text-center text-xs text-muted-foreground">
            {t("shared-links.description.whenSomeoneSendsYouAPrivateLinkOneLimitedToSpecificEmailAddressesIt")}
          </Text>
        </View>
      }
    />
  );
}

function WithMeRow({ link }: { link: SharedWithMe }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const live = link.status === "active" || link.status === "expiring";
  const badges = badgesFor({
    is_password_protected: link.is_password_protected,
    lock_mode: link.lock_mode,
    access_mode: "public",
    recipient_count: 0,
  });

  return (
    <Pressable
      testID={`with-me-row-${link.link_id}`}
      accessibilityRole="button"
      accessibilityLabel={t("shared-links.label.displaynameFromHasSenderSelectTrueSenderNameOtherSomeone", {
        displayName: link.display_name,
        hasSender: String(!!link.sender_name),
        senderName: link.sender_name ?? "",
      })}
      disabled={!live}
      onPress={() => void Linking.openURL(link.url)}
      className="flex-row items-center gap-3 border-b border-border px-5 py-3"
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: live ? avatarColor(link.display_name) : tokens.muted }}
      >
        {link.is_folder ? (
          <Icon name="folder" size={16} color={live ? "#fff" : tokens.mutedForeground} />
        ) : (
          <Text className="text-[8px]" style={{ fontFamily: fonts.bold, color: live ? "#fff" : tokens.mutedForeground }}>
            {avatarLabel(link.display_name, link.extension)}
          </Text>
        )}
      </View>

      <View className="flex-1">
        <Text
          className={"text-sm " + (live ? "text-foreground" : "text-muted-foreground")}
          style={{ fontFamily: fonts.medium }}
          numberOfLines={1}
        >
          {link.display_name}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1.5">
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_COLOR[statusTone(link.status)] }} />
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
            {rtlLine(`${link.sender_name ? t("shared-links.label.fromSenderName", { senderName: link.sender_name }) : t("workspaces.tooltip.sharedWithYou")} · ${timeAgo(link.invited_at)}`)}
          </Text>
          {badges.map((b) => (
            <View key={b.key} accessibilityLabel={b.label}>
              <Icon name={b.icon as never} size={10} color={tokens.mutedForeground} />
            </View>
          ))}
        </View>
      </View>

      {/* Your own fact, never the sender's counters. */}
      <Text className="text-[10px] text-muted-foreground">
        {link.status === "revoked" ? t("common.status.revoked")
          : link.status === "expired" ? t("common.status.expired")
          : link.verified_at ? t("shared-links.status.opened") : t("shared-links.status.new")}
      </Text>
    </Pressable>
  );
}
