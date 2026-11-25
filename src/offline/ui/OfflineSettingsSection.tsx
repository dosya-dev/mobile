import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch } from "react-native";
import { useRouter } from "expo-router";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Text } from "@/ui/Text";
import { ActionSheet } from "@/ui/ActionSheet";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { GB, formatBytes } from "@/lib/format";
import { localDigits } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";
import { useOfflineStore } from "../offlineStore";
import { currentSession } from "../session";
import { bytesRetained } from "../store";
import { removeAll } from "../pins";

/** The storage budget choices, in whole GB; null is Off (the default). */
export const BUDGET_CHOICES_GB: readonly (number | null)[] = [null, 5, 10, 25, 50];

/**
 * Settings > Offline files: how much the phone holds, whether downloads may use
 * mobile data, the optional storage budget, and Remove all. Separate from the
 * cache row above it on purpose - Clear cache never touches offline files,
 * which the user asked us to keep.
 */
export function OfflineSettingsSection() {
  const t = useT();
  const router = useRouter();
  const allowCellular = useOfflineStore((s) => s.allowCellular);
  const budgetBytes = useOfflineStore((s) => s.budgetBytes);
  const pins = useOfflineStore((s) => s.pins);
  const [bytes, setBytes] = useState<number | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => { void useOfflineStore.getState().hydrate(); }, []);

  // Measured, like the cache row: the bytes in the account's files/ directory.
  const measure = useCallback(async () => {
    const s = currentSession();
    setBytes(s ? await bytesRetained(s).catch(() => 0) : 0);
  }, []);
  useEffect(() => { void measure(); }, [measure, pins]);

  const budgetLabel = (gb: number | null) => (gb == null ? t("common.status.off") : t("common.label.sizeGB", { size: localDigits(gb) }));
  const currentGb = budgetBytes == null ? null : Math.round(budgetBytes / GB);

  const onRemoveAll = async () => {
    setConfirmRemove(false);
    setRemoving(true);
    try {
      await removeAll();
    } finally {
      setRemoving(false);
      await measure();
    }
  };

  return (
    <Section title={t("offline.heading.offlineFiles")}>
      <SettingsRow
        icon="arrow-down-circle"
        label={t("offline.label.storageUsedByOfflineFiles")}
        value={bytes == null ? undefined : formatBytes(bytes)}
        border
        testID="settings-offline-size"
        onPress={() => router.push("/offline")}
      />
      <SettingsRow
        icon="cellular"
        label={t("offline.label.downloadOfflineFilesOverMobileData")}
        description={t("offline.description.weCheckForChangesOnAnyConnection")}
        border
        right={
          <Switch
            testID="settings-offline-cellular"
            value={allowCellular}
            onValueChange={(v) => useOfflineStore.getState().setAllowCellular(v)}
          />
        }
      />
      <SettingsRow
        icon="server-outline"
        label={t("offline.label.storageBudget")}
        description={t("offline.description.weStopDownloadingOfflineFilesOnceTheyUseThisMuch")}
        value={budgetLabel(currentGb)}
        border
        testID="settings-offline-budget"
        onPress={() => setBudgetOpen(true)}
      />
      <SettingsRow
        icon="trash-outline"
        label={t("offline.action.removeAllOfflineFiles")}
        testID="settings-offline-remove-all-row"
        right={
          <Pressable
            testID="settings-offline-remove-all"
            accessibilityRole="button"
            // "Remove" alone names nothing to a screen reader; say what goes.
            accessibilityLabel={t("offline.action.removeAllOfflineFiles")}
            disabled={removing}
            onPress={() => setConfirmRemove(true)}
            className="ms-2 rounded-lg bg-secondary px-3 py-1.5"
          >
            <Text className="text-sm text-destructive">{removing ? t("offline.status.removing") : t("common.remove")}</Text>
          </Pressable>
        }
      />

      <ActionSheet
        visible={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        actions={BUDGET_CHOICES_GB.map((gb) => ({
          label: budgetLabel(gb),
          icon: gb === currentGb ? "checkmark" : "server-outline",
          onPress: () => useOfflineStore.getState().setBudget(gb == null ? null : gb * GB),
        }))}
      />

      <ConfirmDialog
        visible={confirmRemove}
        title={t("common.heading.areYouSure")}
        message={t("offline.description.allOfflineFilesSizeWillBeRemovedFromThisPhone", { size: formatBytes(bytes ?? 0) })}
        confirmLabel={t("common.remove")}
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => { void onRemoveAll(); }}
      />
    </Section>
  );
}
