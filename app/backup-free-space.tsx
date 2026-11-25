import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { buildReclaimPlan, runReclaim, type ReclaimPlan } from "@/backup/reclaim";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { formatBytes } from "@/lib/format";
import { byteCount } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";

/**
 * Removes originals from the device that the workspace is confirmed to hold.
 *
 * Every candidate is re-checked against the server as this screen loads, not
 * trusted from the local ledger, because there is no in-app way to put a photo
 * back on the device yet. The screen says so plainly rather than leaving that
 * to a release note.
 */
export default function BackupFreeSpace() {
  const t = useT();
  const { tokens } = useColorTheme();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const [plan, setPlan] = useState<ReclaimPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeId) return;
    setPlan(await buildReclaimPlan(activeId));
  }, [activeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onReclaim = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const removed = await runReclaim(plan);
      if (removed > 0) toast(t("backup.status.removedRemovedOriginalsFromThisDevice", { removed: byteCount(removed) }));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const count = plan?.ids.length ?? 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("backup.heading.freeUpSpace") }} />
      <Screen underNativeHeader title={t("backup.heading.freeUpSpace")}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {plan == null ? (
            <Text testID="reclaim-loading" className="text-sm text-muted-foreground">
              {t("backup.description.checkingWhichPhotosAreSafelyBackedUp")}
            </Text>
          ) : (
            <>
              <View className="mb-3 flex-row items-start gap-2 rounded-2xl border border-border bg-secondary p-3">
                <Icon name="shield-checkmark" size={18} color={tokens.primary} />
                <Text className="flex-1 text-xs text-foreground">
                  {t("backup.description.everyItemBelowWasReCheckedAgainstYourWorkspaceJustNow")}
                </Text>
              </View>

              <View className="rounded-lg border border-border bg-card">
                <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
                  <View className="flex-1">
                    <Text className="text-base text-foreground">{t("backup.label.readyToRemove")}</Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground">
                      {t("backup.description.countPluralOnePhotoOrVideoOtherPhotosAndVideos", { count })}
                    </Text>
                  </View>
                  <Text testID="reclaim-bytes" className="text-base font-semibold text-primary">
                    {formatBytes(plan.bytes)}
                  </Text>
                </View>
                <View className="flex-row items-center justify-between px-4 py-3">
                  <View className="flex-1">
                    <Text className="text-base text-foreground">{t("backup.label.keptOnThisDevice")}</Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground">
                      {t("backup.error.couldNotBeConfirmedInYourWorkspace")}
                    </Text>
                  </View>
                  <Text testID="kept-unverifiable" className="text-base text-muted-foreground">
                    {plan.unverifiable}
                  </Text>
                </View>
              </View>

              <View
                testID="no-restore-notice"
                className="mt-4 flex-row items-start gap-2 rounded-2xl border border-border bg-card p-3"
              >
                <Icon name="warning" size={18} color={tokens.destructive} />
                <Text className="flex-1 text-xs text-foreground">
                  {t("backup.description.removedPhotosStayInYourWorkspaceButThereIsNoInAppWayTo")}
                </Text>
              </View>

              {count > 0 ? (
                <View className="mt-4">
                  <Button
                    testID="reclaim"
                    onPress={onReclaim}
                    loading={busy}
                    title={t("backup.action.countPluralOneRemoveOriginalOtherRemoveOriginals", { count })}
                  />
                  <Text className="mt-2 text-center text-xs text-muted-foreground">
                    {t("backup.description.oneConfirmationNotOnePerPhoto")}
                  </Text>
                </View>
              ) : (
                <Text testID="nothing-to-reclaim" className="mt-4 text-sm text-muted-foreground">
                  {t("backup.description.nothingToRemoveYetPhotosAppearHereOnceTheyAreBackedUpAndConfirmed")}
                </Text>
              )}
            </>
          )}
        </ScrollView>
      </Screen>
    </>
  );
}
