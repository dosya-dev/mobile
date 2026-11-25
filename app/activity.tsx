import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import {
  hasAnyFilter, listActivity, NO_FILTERS,
  type ActivityFilters, type ActivityMember, type ActivityRow,
} from "@/activity/api";
import { ActivityEntry } from "@/activity/ActivityEntry";
import { ActivityFilterSheet } from "@/activity/ActivityFilterSheet";
import { localDigits } from "@/lib/format-locale";

function countFilters(f: ActivityFilters): number {
  return f.categories.length + f.actions.length + f.userIds.length;
}

/**
 * Workspace activity, read-only.
 *
 * It used to carry no filters on purpose - "a phone answering 'what happened'
 * does not need six dropdowns". That held while the feed was short; on a busy
 * workspace it turned "what did Ada do to that folder" into scrolling, and the
 * rows themselves answered almost nothing. So: the three filters the endpoint
 * already supports (category, action, member), gathered into ONE sheet rather
 * than web's three dropdowns, and a row that expands into its own detail.
 *
 * Still no text search - the endpoint has no parameter for one, and a LIKE over
 * audit_events has no index to use.
 */
export default function ActivityScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  const q = useInfiniteQuery({
    // The filters belong in the key: changing one is a different feed, and it
    // has to restart at page one rather than append to the previous answer.
    queryKey: ["activity", ws, filters],
    enabled: !!ws,
    queryFn: ({ pageParam }) => listActivity(ws as string, pageParam as number, filters),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });

  const pages = useMemo(() => q.data?.pages ?? [], [q.data]);
  const rows: ActivityRow[] = pages.flatMap((p) => p.activities);
  // The endpoint repeats the member list on every page; the first page's copy
  // is the one to keep, and it must survive a filter that returns no rows at
  // all - otherwise narrowing to nothing empties the filter that did it.
  const [members, setMembers] = useState<ActivityMember[]>([]);
  const firstPageMembers = pages[0]?.members ?? [];
  if (firstPageMembers.length > 0 && members.length === 0) setMembers(firstPageMembers);

  const total = pages[0]?.total ?? 0;
  const filtered = hasAnyFilter(filters);
  const now = Math.floor(Date.now() / 1000);
  const activeCount = countFilters(filters);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("common.heading.activity") }} />

      <View className="flex-row items-center gap-3 border-b border-border px-5 py-2.5">
        <Text testID="activity-count" className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
          {q.isLoading
            ? t("common.status.loading")
            : t("activity.description.totalPluralOneActivityOtherActivitiesFilteredSelectTrueFilteredOther", {
                total,
                filtered: String(filtered),
              })}
        </Text>
        <Pressable
          testID="activity-filter-open"
          accessibilityRole="button"
          accessibilityLabel={
            activeCount > 0
              ? t("activity.label.filterActivityActiveCountActive", { activeCount: localDigits(activeCount) })
              : t("activity.action.filterActivity")
          }
          onPress={() => setFilterOpen(true)}
          className={
            "flex-row items-center gap-1.5 rounded-lg border px-3 py-1.5 " +
            (filtered ? "border-primary" : "border-border")
          }
        >
          <Icon name="options-outline" size={14} color={filtered ? tokens.primary : tokens.mutedForeground} />
          <Text
            className={"text-xs " + (filtered ? "text-primary" : "text-foreground")}
            style={{ fontFamily: fonts.medium }}
          >
            {filtered ? t("activity.label.filtersActiveCount", { activeCount: localDigits(activeCount) }) : t("activity.action.filter")}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ActivityEntry row={item} now={now} />}
        ListEmptyComponent={
          q.isLoading ? (
            <View className="mt-10 items-center"><ActivityIndicator color={tokens.primary} /></View>
          ) : (
            <View className="mt-10 items-center px-8">
              <Text className="text-center text-muted-foreground" testID="activity-empty">
                {filtered ? t("activity.description.nothingMatchesTheseFilters") : t("activity.description.nothingHasHappenedHereYet")}
              </Text>
              {/* An empty feed that the user filtered into needs the way out,
                  not just the bad news. */}
              {filtered ? (
                <Pressable
                  testID="activity-clear-filters"
                  accessibilityRole="button"
                  onPress={() => setFilters(NO_FILTERS)}
                  className="mt-3 rounded-lg border border-border px-3 py-1.5"
                >
                  <Text className="text-xs text-foreground">{t("activity.action.clearFilters")}</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          <View className="items-center gap-2 py-4">
            {/* A failed page keeps the rows already loaded and offers a retry,
                rather than emptying the list under someone mid-read. */}
            {q.isError ? (
              <Text className="text-xs text-destructive" testID="activity-error">
                {t("activity.error.couldNotLoadMoreTryAgain")}
              </Text>
            ) : null}
            {q.hasNextPage || q.isError ? (
              <Pressable
                testID="activity-load-more"
                accessibilityRole="button"
                onPress={() => { void q.fetchNextPage(); }}
                className="rounded-lg border border-border px-3 py-1.5"
              >
                <Text className="text-xs text-foreground">
                  {q.isFetchingNextPage ? t("common.status.loading") : q.isError ? t("common.retry") : t("notifications.action.loadOlder")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
      />

      <ActivityFilterSheet
        visible={filterOpen}
        filters={filters}
        members={members}
        onApply={(next) => { setFilters(next); setFilterOpen(false); }}
        onClose={() => setFilterOpen(false)}
      />
    </SafeAreaView>
  );
}
