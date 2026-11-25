import { memo } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { DEFAULT_PAGE_SIZE, ListPager, usePager } from "@/ui/ListPager";
import { formatWhen } from "@/lib/format";
import { byteCount } from "@/lib/format-locale";
import { rtlLine, t, useT } from "@/lib/i18n";
import type { BackupPhase } from "@/backup/runState";
import type { BackupRunRecord } from "@/backup/history";
import type { UploadItem } from "@/upload/types";
import { itemErrorText } from "@/upload/uploadError";
function historySubline(r: BackupRunRecord): string {
  if (r.uploaded === 0 && r.deduped === 0 && r.failed === 0) return t("backup.status.nothingNew");
  // One message: each language joins the parts its own way, and the deduped
  // and failed parts appear only when there is something to say.
  return t("backup.status.uploadedBackedUpHasDedupedSelectTrueDedupedAlreadyBackedUpOtherHasFailedSelectTrue", {
    uploaded: byteCount(r.uploaded),
    hasDeduped: String(r.deduped > 0),
    deduped: byteCount(r.deduped),
    hasFailed: String(r.failed > 0),
    failed: byteCount(r.failed),
  });
}

// Memoized: the store preserves refs for untouched items, so only the row
// whose progress actually changed re-renders on each patch.
const LiveRow = memo(function LiveRow({ item }: { item: UploadItem }) {
  const pct = Math.round(item.progress * 100);
  return (
    <View className="border-b border-border px-4 py-3">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {item.name}
        </Text>
        <Text className="text-xs text-muted-foreground">{pct}%</Text>
      </View>
      <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
})

/** Runs per page of the history list. See ListPager for why it is small. */
export const HISTORY_PAGE_SIZE = DEFAULT_PAGE_SIZE;

/** items must already be filtered to backup (`bk_`) uploads by the caller. */
export function ActivityFeed({
  phase,
  items,
  history,
}: {
  phase: BackupPhase;
  items: UploadItem[];
  history: BackupRunRecord[];
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const pager = usePager(history.length, HISTORY_PAGE_SIZE);
  const shown = history.slice(pager.from, pager.to);
  const uploading = items.filter((i) => i.status === "uploading");
  const queued = items.filter((i) => i.status === "queued").length;
  const errored = items.filter((i) => i.status === "error");
  const scanningOnly = phase === "scanning" && uploading.length === 0 && queued === 0;
  const hasLive = scanningOnly || uploading.length > 0 || queued > 0 || errored.length > 0;
  return (
    <View className="mt-8 mb-6">
      <Text className="mb-2 text-sm font-semibold text-muted-foreground">{t("common.heading.activity")}</Text>
      {hasLive ? (
        <View className="mb-3 overflow-hidden rounded-2xl border border-border bg-card">
          {scanningOnly ? (
            <View testID="backup-active" className="flex-row items-center gap-2 px-4 py-3">
              <ActivityIndicator size="small" color={tokens.primary} />
              <Text className="text-sm font-medium text-foreground">{t("backup.label.scanningYourLibrary")}</Text>
            </View>
          ) : null}
          {uploading.map((i) => (
            <LiveRow key={i.id} item={i} />
          ))}
          {queued > 0 ? (
            <View className="flex-row items-center gap-2 px-4 py-3">
              <Icon name="ellipse-outline" size={14} color={tokens.mutedForeground} />
              <Text testID="queued-count" className="text-sm text-muted-foreground">
                {t("backup.label.queuedQueued", { queued: byteCount(queued) })}
              </Text>
            </View>
          ) : null}
          {errored.length > 0 ? (
            <View testID="backup-error" className="px-4 py-3">
              {errored.slice(0, 5).map((i) => (
                <View key={i.id} className="flex-row items-center gap-2 py-0.5">
                  <Icon name="alert-circle" size={14} color={tokens.destructive} />
                  <Text className="flex-1 text-xs text-destructive" numberOfLines={2}>
                    {t("backup.error.nameReason", { name: i.name, reason: itemErrorText(i, t) ?? t("common.error.uploadFailed") })}
                  </Text>
                </View>
              ))}
              {errored.length > 5 ? (
                <Text className="ps-6 pt-1 text-xs text-muted-foreground">{t("backup.error.countMoreFailed", { count: byteCount(errored.length - 5) })}</Text>
              ) : null}
              <Pressable
                testID="backup-report"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.push({ pathname: "/report-problem", params: { from: "/backup", errorMessage: t("backup.error.erroredcountPluralOneUploadOtherUploadsFailed", { erroredCount: errored.length }) } })}
                className="ps-6 pt-2 pb-1"
              >
                <Text className="text-xs text-primary">{t("backup.action.reportThis")}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
      <View testID="backup-history" className="rounded-2xl border border-border bg-card">
        {history.length === 0 ? (
          <Text className="p-4 text-center text-sm text-muted-foreground">{t("backup.description.noBackupsYet")}</Text>
        ) : (
          shown.map((r, i) => (
            <View key={r.id} className={`px-4 py-3 ${i === shown.length - 1 ? "" : "border-b border-border"}`}>
              <View className="flex-row items-center gap-2">
                <Icon
                  name={r.failed > 0 ? "alert-circle" : "checkmark-circle"}
                  size={14}
                  color={r.failed > 0 ? tokens.destructive : tokens.accent}
                />
                <Text className="text-sm text-foreground">
                  {rtlLine(`${formatWhen(r.at)} · ${r.workspace_name ?? t("common.label.workspace")}`)}
                </Text>
              </View>
              <Text className="mt-0.5 ps-6 text-xs text-muted-foreground">{historySubline(r)}</Text>
            </View>
          ))
        )}
      </View>
      <ListPager pager={pager} testID="backup-history-pager" what="backups" />
    </View>
  );
}

