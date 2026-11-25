import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { Icon } from "@/ui/Icon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { toast } from "@/ui/toast";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { formatBytes } from "@/files/format";
import { useT } from "@/lib/i18n";
import { byteCount } from "@/lib/format-locale";
import { getDuplicates, deleteDuplicates } from "@/duplicates/api";
import {
  allButNewest, fullySelectedGroups, selectedBytes, selectedCount, toggle,
  type DuplicateGroup,
} from "@/duplicates/select";

/** Refetch while the hash scan still has candidates left. */
const SCAN_POLL_MS = 15_000;

/**
 * Identical files, by content rather than by name.
 *
 * Selecting every copy in a group is allowed, matching web and desktop, but the
 * confirm step names it: it is the one selection that leaves no copy behind.
 */
export default function DuplicatesScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const q = useQuery({
    queryKey: ["duplicates", ws],
    enabled: !!ws,
    queryFn: () => getDuplicates(ws as string),
    refetchInterval: (query) => ((query.state.data?.pending ?? 0) > 0 ? SCAN_POLL_MS : false),
  });

  const groups = q.data?.groups ?? [];
  // The full count, which the endpoint reports separately from the capped page.
  const totalGroups = q.data?.total_groups ?? 0;
  const pending = q.data?.pending ?? 0;
  const count = selectedCount(groups, selected);
  const bytes = selectedBytes(groups, selected);
  const fullGroups = fullySelectedGroups(groups, selected);

  const remove = useMutation({
    mutationFn: () => deleteDuplicates(ws as string, [...selected]),
    onSuccess: ({ deleted, total }) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["duplicates"] });
      void qc.invalidateQueries({ queryKey: ["files"] });
      toast(deleted === total
        ? t("duplicates.status.movedDeletedToTrash", { deleted: byteCount(deleted) })
        : t("duplicates.status.movedDeletedOfTotalToTrash", { deleted: byteCount(deleted), total: byteCount(total) }));
    },
    onError: (e) => {
      // The refetch matters as much as the message: some chunks may have landed
      // before the failure, and the list must stop showing what is already gone.
      void qc.invalidateQueries({ queryKey: ["duplicates"] });
      toast(e instanceof Error ? e.message : t("duplicates.error.couldNotMoveThoseToTrash"), "error");
    },
  });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("duplicates.heading.duplicates") }} />

      {q.isLoading ? (
        <View className="mt-16 items-center"><ActivityIndicator color={tokens.primary} /></View>
      ) : q.isError || !ws ? (
        <View className="mt-16 items-center px-8" testID="duplicates-error">
          <Icon name="cloud-offline-outline" size={26} color={tokens.mutedForeground} />
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            {t("duplicates.error.couldnTCheckForDuplicates")}
          </Text>
          <Pressable
            testID="duplicates-retry"
            accessibilityRole="button"
            onPress={() => void q.refetch()}
            className="mt-3 rounded-lg border border-border px-3 py-1.5"
          >
            <Text className="text-xs text-foreground">{t("common.retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View className="flex-row items-center justify-between border-b border-border px-5 py-2.5">
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
              {groups.length
                ? t("duplicates.label.countPluralOneGroupOtherGroupsSizeReclaimable", { count: totalGroups, size: formatBytes(q.data?.total_wasted_bytes ?? 0) })
                : t("duplicates.label.nothingStoredTwice")}
            </Text>
            {groups.length > 0 ? (
              <Pressable
                testID="duplicates-select-all-but-newest"
                accessibilityRole="button"
                onPress={() => setSelected(new Set(allButNewest(groups)))}
              >
                <Text className="text-xs text-primary" style={{ fontFamily: fonts.medium }}>
                  {t("duplicates.label.allButNewest")}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {pending > 0 ? (
            <Text testID="duplicates-scanning" className="px-5 py-2 text-[11px] text-muted-foreground">
              {t("duplicates.description.stillScanningPendingPluralOneFileOtherFilesThisListWillFillIn", { pending })}
            </Text>
          ) : null}

          <ScrollView contentContainerClassName="pb-28">
            {groups.length === 0 ? (
              <View className="mt-16 items-center px-8" testID="duplicates-empty">
                <Icon name="checkmark-circle-outline" size={28} color={tokens.primary} />
                <Text className="mt-2 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                  {t("duplicates.empty.noDuplicates")}
                </Text>
                <Text className="mt-0.5 text-center text-xs text-muted-foreground">
                  {t("duplicates.description.nothingInThisWorkspaceIsStoredTwice")}
                </Text>
              </View>
            ) : (
              groups.map((g) => (
                <GroupCard
                  key={g.content_hash}
                  group={g}
                  selected={selected}
                  onToggle={(id) => setSelected((prev) => toggle(prev, id))}
                />
              ))
            )}
            {/* The endpoint returns the 100 largest groups but counts them all,
                and the header above already shows that full count - so without
                this the screen claims 340 groups and then runs out of list at
                100 with nothing said. Same line the web page shows. */}
            {totalGroups > groups.length ? (
              <Text testID="duplicates-truncated" className="px-5 py-3 text-center text-xs text-muted-foreground">
                {t("duplicates.description.showingTheGroupsCountLargestGroupsOfTotalGroupsCleanTheseUpAndTheRestMove", { groupsCount: byteCount(groups.length), totalGroups: byteCount(totalGroups) })}
              </Text>
            ) : null}
          </ScrollView>

          {count > 0 ? (
            <View className="absolute inset-x-0 bottom-0 border-t border-border bg-card px-5 pb-7 pt-3">
              <View className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                    {t("files.label.totalselectedSelected", { totalSelected: byteCount(count) })}
                  </Text>
                  <Text className="text-xs text-muted-foreground">{t("duplicates.label.sizeReclaimable", { size: formatBytes(bytes) })}</Text>
                </View>
                <Pressable
                  testID="duplicates-clear"
                  accessibilityRole="button"
                  onPress={() => setSelected(new Set())}
                  className="rounded-lg border border-border px-3 py-2"
                >
                  <Text className="text-xs text-foreground">{t("common.action.clear")}</Text>
                </Pressable>
                <Pressable
                  testID="duplicates-delete"
                  accessibilityRole="button"
                  disabled={remove.isPending}
                  onPress={() => setConfirming(true)}
                  className="flex-row items-center gap-1.5 rounded-lg bg-destructive px-3 py-2"
                >
                  {remove.isPending ? (
                    <ActivityIndicator size="small" color={tokens.destructiveForeground ?? "#fff"} />
                  ) : (
                    <Icon name="trash-outline" size={14} color={tokens.destructiveForeground ?? "#fff"} />
                  )}
                  <Text className="text-xs text-destructive-foreground" style={{ fontFamily: fonts.medium }}>
                    {t("common.label.trash")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={confirming}
        title={t("duplicates.heading.moveCountPluralOneFileOtherFilesToTrash", { count })}
        message={
          fullGroups > 0
            ? t("duplicates.description.thisReclaimsSizeFullGroupsGroupFullGroupsPluralOneHasOtherSHaveEveryCopy", { size: formatBytes(bytes), fullGroups })
            : t("duplicates.description.thisReclaimsSizeTheyGoToTrashNotStraight", { size: formatBytes(bytes) })
        }
        confirmLabel={t("common.action.moveToTrash")}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); remove.mutate(); }}
      />
    </SafeAreaView>
  );
}

function GroupCard(props: {
  group: DuplicateGroup;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const g = props.group;

  return (
    <View testID={`dup-group-${g.content_hash}`} className="border-b border-border px-5 py-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
          {g.files[0]?.name ?? t("common.label.unnamed")}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {t("duplicates.label.countCopiesSize", { count: byteCount(g.count), size: formatBytes(g.wasted_bytes) })}
        </Text>
      </View>

      {g.files.map((f, i) => {
        const on = props.selected.has(f.id);
        return (
          <Pressable
            key={f.id}
            testID={`dup-file-${f.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => props.onToggle(f.id)}
            className="mt-2 flex-row items-center gap-2.5"
          >
            <Icon
              name={on ? "checkbox" : "square-outline"}
              size={19}
              color={on ? tokens.primary : tokens.mutedForeground}
            />
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
              {f.folder_path ?? t("common.label.workspaceRoot")}
            </Text>
            {i === 0 ? (
              <View testID={`dup-newest-${f.id}`} className="rounded-full bg-secondary px-1.5 py-0.5">
                <Text className="text-[11px] text-muted-foreground">{t("duplicates.label.newest")}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
