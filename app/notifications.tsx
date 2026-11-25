import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { toast } from "@/ui/toast";
import { rtlLine, useT } from "@/lib/i18n";
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification,
} from "@/notifications/api";
import {
  mergeInboxPages, groupByDay, parseActions, isUnread, relativeTime,
  type InboxItem,
} from "@/notifications/inbox";
import { mapActionPath } from "@/notifications/actionPath";
import { NotificationIcon } from "@/notifications/NotificationIcon";

type Row =
  | { kind: "header"; label: string }
  | { kind: "item"; item: InboxItem };

export default function NotificationsScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();

  const q = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ pageParam }) => listNotifications(pageParam as number | null),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });

  // Server pages are the source of truth. Local edits are held as id sets and
  // projected over them, rather than as a snapshot of the list: a snapshot gets
  // stale the moment another page loads, and a dismissed row would reappear.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [readAllAt, setReadAllAt] = useState<number | null>(null);

  const serverItems = useMemo(
    () => mergeInboxPages((q.data?.pages ?? []).map((p) => p.items)),
    [q.data],
  );

  const items = useMemo(
    () =>
      serverItems
        .filter((i) => !dismissedIds.has(i.id))
        .map((i) => {
          if (i.read_at != null) return i;
          if (readAllAt != null) return { ...i, read_at: readAllAt };
          if (readIds.has(i.id)) return { ...i, read_at: Math.floor(Date.now() / 1000) };
          return i;
        }),
    [serverItems, dismissedIds, readIds, readAllAt],
  );

  const resetLocal = () => {
    setReadIds(new Set());
    setDismissedIds(new Set());
    setReadAllAt(null);
  };

  const now = Math.floor(Date.now() / 1000);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of groupByDay(items, now)) {
      out.push({ kind: "header", label: g.label });
      for (const item of g.items) out.push({ kind: "item", item });
    }
    return out;
    // `now` deliberately not a dependency: re-grouping every second would
    // rebuild the list while the user is reading it. `t` is: the day headings
    // are text, and they must follow a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, t]);

  const bumpBadge = () => qc.invalidateQueries({ queryKey: ["notifications", "summary"] });

  const onRead = (item: InboxItem) => {
    if (!isUnread(item)) return;
    setReadIds((prev) => new Set(prev).add(item.id));
    markNotificationRead(item.id)
      .then(bumpBadge)
      .catch(() => { resetLocal(); void q.refetch(); });
  };

  const onDismiss = (item: InboxItem) => {
    setDismissedIds((prev) => new Set(prev).add(item.id));
    dismissNotification(item.id)
      .then(bumpBadge)
      .catch(() => { resetLocal(); void q.refetch(); });
  };

  const onReadAll = () => {
    setReadAllAt(Math.floor(Date.now() / 1000));
    markAllNotificationsRead()
      .then(bumpBadge)
      .catch(() => { toast(t("notifications.error.couldNotMarkAllRead"), "error"); resetLocal(); void q.refetch(); });
  };

  const openItem = (item: InboxItem) => {
    onRead(item);
    // A server-authored WEB route; null means mobile has no equivalent, in which
    // case the row is still readable but goes nowhere rather than opening a
    // blank screen.
    const target = mapActionPath(item.link_path);
    if (target) router.push(target as never);
  };

  const anyUnread = items.some(isUnread);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("common.heading.notifications"),
          headerRight: () =>
            anyUnread ? (
              <Pressable testID="mark-all-read" onPress={onReadAll} hitSlop={8} accessibilityRole="button">
                <Text className="text-sm text-primary">{t("notifications.action.markAllRead")}</Text>
              </Pressable>
            ) : null,
        }}
      />

      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === "header" ? `h:${r.label}` : `i:${r.item.id}`)}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        renderItem={({ item: row }) => {
          if (row.kind === "header") {
            return (
              <Text
                className="px-5 pb-1 pt-4 text-xs uppercase text-muted-foreground"
                style={{ fontFamily: fonts.medium, letterSpacing: 0.6 }}
              >
                {row.label}
              </Text>
            );
          }
          const item = row.item;
          const unread = isUnread(item);
          const actions = parseActions(item.actions);
          return (
            <Pressable
              testID={`notification-${item.id}`}
              accessibilityRole="button"
              onPress={() => openItem(item)}
              className="flex-row gap-3 border-b border-border px-5 py-3"
            >
              <NotificationIcon
                icon={item.icon}
                category={item.category}
                priority={item.priority}
                unread={unread}
              />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text
                    className="shrink text-base text-foreground"
                    style={{ fontFamily: unread ? fonts.medium : fonts.regular }}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  {/* Unread is carried by a dot, not by a tinted row: a coloured
                      background on every unread item turns the whole list into an
                      alert. */}
                  {unread ? (
                    <View
                      testID={`unread-dot-${item.id}`}
                      className="size-2 rounded-full"
                      style={{ backgroundColor: tokens.primary }}
                    />
                  ) : null}
                </View>
                {item.body ? (
                  <Text className="mt-0.5 text-sm text-muted-foreground" numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}
                <Text className="mt-1 text-xs text-muted-foreground">
                  {rtlLine(`${relativeTime(item.created_at, now)}${item.actor_name ? ` · ${item.actor_name}` : ""}`)}
                </Text>
                {actions.length > 0 ? (
                  <View className="mt-2 flex-row gap-4">
                    {actions.map((a, i) => {
                      const to = a.handler === "navigate" ? mapActionPath(a.params?.path) : null;
                      // A navigate action with no mobile equivalent renders
                      // nothing at all. Showing it and doing nothing would be
                      // worse than its absence.
                      if (a.handler === "navigate" && !to) return null;
                      return (
                        <Pressable
                          key={i}
                          testID={`action-${item.id}-${i}`}
                          hitSlop={6}
                          accessibilityRole="button"
                          onPress={() => {
                            if (a.handler === "dismiss") onDismiss(item);
                            else if (to) { onRead(item); router.push(to as never); }
                          }}
                        >
                          <Text className="text-sm text-primary" style={{ fontFamily: fonts.medium }}>
                            {a.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              <Pressable
                testID={`dismiss-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t("notifications.accessibility.dismissTitle", { title: item.title })}
                hitSlop={8}
                onPress={() => onDismiss(item)}
              >
                <Icon name="close" size={18} color={tokens.mutedForeground} />
              </Pressable>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          q.isLoading ? (
            <View className="mt-10 items-center"><ActivityIndicator color={tokens.primary} /></View>
          ) : (
            <Text className="mt-10 text-center text-muted-foreground" testID="inbox-empty">
              {t("notifications.description.youReAllCaughtUp")}
            </Text>
          )
        }
        ListFooterComponent={
          q.isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator color={tokens.primary} /></View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
