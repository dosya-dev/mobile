import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { ListPager, usePager } from "@/ui/ListPager";
import { countByStatus, listByStatus, resetForRetry, type LedgerRow } from "@/backup/ledger";
import { runBackup } from "@/backup/orchestrator";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { formatBytes } from "@/lib/format";
import { byteCount } from "@/lib/format-locale";
import { rtlLine, useT } from "@/lib/i18n";

/**
 * Assets the engine gave up on, and assets it skipped for being too big.
 *
 * Before this screen the Failed tile was a number that went nowhere: past
 * MAX_BACKUP_ATTEMPTS the scan skips an asset permanently and there was no way
 * back. Retrying here zeroes the attempt count, which is what actually releases
 * it.
 */
export default function BackupFailed() {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const [failed, setFailed] = useState<LedgerRow[]>([]);
  const [skipped, setSkipped] = useState<LedgerRow[]>([]);
  // The TRUE totals. listByStatus stops at 200 rows, which is the right amount
  // of the ledger to hold in memory but the wrong number to put in front of
  // someone - a run that failed 1,300 items would otherwise present itself as
  // 200, and "Retry all 200" would then go on to retry all 1,300.
  const [totals, setTotals] = useState({ error: 0, skipped_large: 0 });
  const [busy, setBusy] = useState(false);
  const failedPager = usePager(failed.length);
  const skippedPager = usePager(skipped.length);

  const refresh = useCallback(async () => {
    if (!activeId) return;
    setFailed(await listByStatus(activeId, ["error"]));
    setSkipped(await listByStatus(activeId, ["skipped_large"]));
    const counts = await countByStatus(activeId);
    setTotals({ error: counts.error, skipped_large: counts.skipped_large });
  }, [activeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retryAll = async () => {
    if (!activeId || busy) return;
    setBusy(true);
    try {
      const n = await resetForRetry(activeId);
      await refresh();
      // The reset only makes them eligible again; the run is what re-uploads.
      await runBackup(activeId);
      toast(t("backup.status.countPluralOneRetryingItemOtherRetryingItems", { count: n }));
      await refresh();
    } catch (e) {
      const error = e instanceof Error ? e.message : "";
      toast(t("backup.error.retryFailedHasErrorSelectTrueErrorOtherUnknownError", { hasError: String(e instanceof Error), error }), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("backup.error.failedItems") }} />
      <Screen underNativeHeader title={t("backup.error.failedItems")}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {failed.length === 0 && skipped.length === 0 ? (
            <Text testID="no-failures" className="text-sm text-muted-foreground">
              {t("backup.description.nothingHasFailedEveryItemInThisWorkspaceEitherFinishedOrIsStillQueued")}
            </Text>
          ) : null}

          {failed.length > 0 ? (
            <>
              <View className="mb-3 flex-row items-start gap-2 rounded-2xl border border-border bg-secondary p-3">
                <Icon name="refresh-circle" size={18} color={tokens.primary} />
                <Text className="flex-1 text-xs text-foreground">
                  {t("backup.description.theseStoppedBeingRetriedAfterSeveralAttemptsRetryingStartsThemOver")}
                </Text>
              </View>
              <View className="rounded-lg border border-border bg-card">
                {failed.slice(failedPager.from, failedPager.to).map((r, i, page) => (
                  <ItemRow key={r.local_id} row={r} border={i < page.length - 1} />
                ))}
              </View>
              <ListPager pager={failedPager} testID="failed-pager" what="failed items" />
              <TruncationNote testID="failed-truncated" loaded={failed.length} total={totals.error} />
              <View className="mt-3">
                {/* Counts the whole ledger, not the page or the 200 loaded:
                    retryAll resets every error row, so a smaller number here
                    would promise less than the button actually does. */}
                <Button
                  testID="retry-all"
                  onPress={retryAll}
                  disabled={busy}
                  title={totals.error === 1 ? t("backup.action.retry1Item") : t("backup.action.retryAllError", { error: byteCount(totals.error) })}
                />
                <Button
                  testID="report-failures"
                  title={t("backup.action.reportTheseFailures")}
                  variant="ghost"
                  onPress={() => router.push({
                    pathname: "/report-problem",
                    params: { from: "/backup-failed", errorMessage: t("backup.error.errorBackupErrorPluralOneItemOtherItemsFailed", { error: totals.error }) },
                  })}
                />
              </View>
            </>
          ) : null}

          {skipped.length > 0 ? (
            <>
              <Text className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">
                {t("backup.heading.skippedByYourSizeLimit")}
              </Text>
              <View className="rounded-lg border border-border bg-card">
                {skipped.slice(skippedPager.from, skippedPager.to).map((r, i, page) => (
                  <ItemRow key={r.local_id} row={r} border={i < page.length - 1} />
                ))}
              </View>
              <ListPager pager={skippedPager} testID="skipped-pager" what="skipped items" />
              <TruncationNote testID="skipped-truncated" loaded={skipped.length} total={totals.skipped_large} />
              {/* Retrying these would re-skip them on the very next scan, so the
                  only action that can help is changing the limit itself. */}
              <View className="mt-3">
                <Button
                  testID="raise-limit"
                  variant="ghost"
                  onPress={() => router.back()}
                  title={t("backup.action.changeTheSizeLimit")}
                />
              </View>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </>
  );
}

/**
 * Says when the screen is holding fewer rows than the ledger has. The list is
 * capped at 200 for memory; pretending that is the whole story is how "retry
 * all 200" ends up retrying 1,300.
 */
function TruncationNote({ testID, loaded, total }: { testID: string; loaded: number; total: number }) {
  const t = useT();
  if (total <= loaded) return null;
  return (
    <Text testID={testID} className="mt-2 text-center text-xs text-muted-foreground">
      {t("backup.description.showingTheLoadedMostRecentOfTotal", { loaded: byteCount(loaded), total: byteCount(total) })}
    </Text>
  );
}

function ItemRow({ row, border }: { row: LedgerRow; border?: boolean }) {
  const detail = [formatBytes(row.size), row.last_error].filter(Boolean).join(" · ");
  return (
    <View className={"px-4 py-3" + (border ? " border-b border-border" : "")}>
      <Text className="text-base text-foreground" numberOfLines={1}>{row.filename}</Text>
      <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>{rtlLine(detail)}</Text>
    </View>
  );
}
