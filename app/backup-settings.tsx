import { useEffect, useState } from "react";
import { Platform, ScrollView, Switch, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { SettingsRow } from "@/ui/SettingsRow";
import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { useBackupSettings } from "@/backup/settings";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { formatBytes } from "@/lib/format";
import { formatDateWith } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * Size-cap presets. Videos are what actually blow through a storage plan.
 *
 * Labels are written out rather than run through formatBytes, which renders
 * "1.0 GB" - right for a live transfer readout, clumsy for a fixed choice.
 * The table holds message keys; the words are produced at render.
 */
const SIZE_CAPS: { label: MessageKey; short: MessageKey; value: number | null }[] = [
  { label: "backup.label.noLimit", short: "backup.label.noLimit", value: null },
  { label: "backup.action.skipFilesOver200MB", short: "backup.label.over200MB", value: 200 * MB },
  { label: "backup.action.skipFilesOver1GB", short: "backup.label.over1GB", value: GB },
  { label: "backup.action.skipFilesOver5GB", short: "backup.label.over5GB", value: 5 * GB },
];

const DAY = 24 * 60 * 60;

/** Date-floor presets, so a first run on a huge library is not all-or-nothing. */
const START_FROM: { label: MessageKey; days: number | null }[] = [
  { label: "backup.label.everythingInMyLibrary", days: null },
  { label: "backup.label.onlyFromTodayOnward", days: 0 },
  { label: "backup.label.theLast30Days", days: 30 },
  { label: "backup.label.theLastYear", days: 365 },
];

export default function BackupSettingsScreen() {
  const t = useT();
  const router = useRouter();
  const settings = useBackupSettings((s) => s.settings);
  const update = useBackupSettings((s) => s.update);
  const updateFilters = useBackupSettings((s) => s.updateFilters);
  const hydrate = useBackupSettings((s) => s.hydrate);
  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId);

  const [sheet, setSheet] = useState<"size" | "start" | null>(null);
  const { filters } = settings;

  const toggleDestination = (id: string, on: boolean) => {
    const current = new Set(settings.destinationIds);
    if (on) current.add(id);
    else current.delete(id);
    void update({ destinationIds: [...current] });
  };

  const toggleMediaType = (t: "photo" | "video", on: boolean) => {
    const next = on
      ? [...new Set([...filters.mediaTypes, t])]
      : filters.mediaTypes.filter((x) => x !== t);
    // Refuse to empty the list: with no media types selected the engine would
    // scan, find nothing, and report success - a backup that silently covers
    // nothing at all.
    if (next.length === 0) return;
    void updateFilters({ mediaTypes: next.sort() as ("photo" | "video")[] });
  };

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const folderSummary =
    filters.albumMode === "all"
      ? t("backup.label.everyFolder")
      : t("backup.label.countPluralOneFolderOtherFolders", { count: filters.albumIds.length });

  const startSummary =
    filters.dateFloor == null
      ? t("backup.label.everythingInMyLibrary")
      : t("backup.label.fromDate", { date: formatDateWith(filters.dateFloor, {}) });

  const sizeActions: SheetAction[] = SIZE_CAPS.map((c) => ({
    label: t(c.label),
    onPress: () => updateFilters({ maxBytes: c.value }),
  }));

  const startActions: SheetAction[] = START_FROM.map((p) => ({
    label: t(p.label),
    onPress: () =>
      updateFilters({
        dateFloor: p.days == null ? null : Math.floor(Date.now() / 1000) - p.days * DAY,
      }),
  }));

  return (
    <>
      {/* Pushed from Settings, so it needs the header's back arrow: without it the only way
          out is the iOS swipe or the Android hardware key. */}
      <Stack.Screen options={{ headerShown: true, title: t("backup.heading.backupSettings") }} />
      <Screen underNativeHeader title={t("backup.heading.backupSettings")}>
        {/* Four sections do not fit on a phone, and Screen deliberately does not scroll
            (some of its screens own a FlatList). Without this, everything from "Storage on
            this device" down was off the bottom edge. The sheets stay outside: they are
            overlays, not page content. */}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <Text className="mb-4 text-sm text-muted-foreground">
            {t("backup.description.chooseWhatGetsBackedUpAndWhenAutomaticBackupRunsInTheBackgroundWhen")}
          </Text>

          <Text className="mb-2 text-sm font-semibold text-muted-foreground">{t("backup.heading.whatToBackUp")}</Text>
          <View className="rounded-lg border border-border bg-card">
            <SettingsRow
              label={t("common.label.photos")}
              border
              right={
                <Switch
                  testID="filter-photos"
                  value={filters.mediaTypes.includes("photo")}
                  onValueChange={(v) => toggleMediaType("photo", v)}
                />
              }
            />
            <SettingsRow
              label={t("common.label.videos")}
              description={t("backup.description.videosAreUsuallyMostOfTheStorageABackupUses")}
              border
              right={
                <Switch
                  testID="filter-videos"
                  value={filters.mediaTypes.includes("video")}
                  onValueChange={(v) => toggleMediaType("video", v)}
                />
              }
            />
            <SettingsRow
              testID="filter-folders"
              label={t("backup.action.deviceFolders")}
              description={folderSummary}
              border
              onPress={() => router.push("/backup-folders")}
            />
            <SettingsRow
              testID="filter-start-from"
              label={t("backup.action.startFrom")}
              description={startSummary}
              border
              onPress={() => setSheet("start")}
            />
            <SettingsRow
              testID="filter-max-size"
              label={t("backup.action.skipLargeFiles")}
              description={
                (() => {
                  const cap = SIZE_CAPS.find((c) => c.value === filters.maxBytes);
                  return cap ? t(cap.short) : t("backup.label.overSize", { size: formatBytes(filters.maxBytes ?? 0) });
                })()
              }
              onPress={() => setSheet("size")}
            />
          </View>

          <Text className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">{t("backup.heading.whenToBackUp")}</Text>
          <View className="rounded-lg border border-border bg-card">
            <Row label={t("backup.label.automaticBackup")} value={settings.autoBackup} onChange={(v) => update({ autoBackup: v })} testID="backup-auto" border />
            <Row label={t("backup.label.wiFiOnly")} value={settings.wifiOnly} onChange={(v) => update({ wifiOnly: v })} testID="backup-wifi-only" border />
            <Row
              label={t("backup.label.onlyWhileCharging")}
              value={settings.chargingOnly}
              onChange={(v) => update({ chargingOnly: v })}
              testID="backup-charging-only"
              border={Platform.OS === "ios"}
            />
            {Platform.OS === "ios" ? (
              <Row
                label={t("backup.label.uploadWhileLocked")}
                value={settings.backgroundTransport}
                onChange={(v) => update({ backgroundTransport: v })}
                testID="backup-background-transport"
              />
            ) : null}
          </View>

          <Text className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">{t("backup.heading.storageOnThisDevice")}</Text>
          <View className="rounded-lg border border-border bg-card">
            <SettingsRow
              testID="free-up-space"
              label={t("backup.action.freeUpSpace")}
              description={t("backup.label.removeOriginalsThatAreSafelyBackedUp")}
              border
              onPress={() => router.push("/backup-free-space")}
            />
            <Row label={t("backup.label.deleteOriginalsAfterBackup")} value={settings.deleteAfterBackup} onChange={(v) => update({ deleteAfterBackup: v })} testID="backup-delete-after" />
          </View>

          {(workspaces.data?.length ?? 0) > 1 ? (
            <>
              <Text className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">{t("backup.heading.backUpTo")}</Text>
              <Text className="mb-3 text-xs text-muted-foreground">
                {t("backup.description.everyBackupRunCopiesYourPhotosToEachSelectedWorkspaceWithNoneSelectedBackups")}
              </Text>
              <View testID="backup-destinations" className="rounded-lg border border-border bg-card">
                {workspaces.data!.map((w, i) => (
                  <Row
                    key={w.id}
                    label={t("backup.label.workspacenameIsActiveSelectTrueActiveOther", { workspaceName: w.name, isActive: String(w.id === activeId) })}
                    value={settings.destinationIds.includes(w.id)}
                    onChange={(v) => toggleDestination(w.id, v)}
                    testID={`backup-dest-${w.id}`}
                    border={i < workspaces.data!.length - 1}
                  />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        <ActionSheet visible={sheet === "size"} onClose={() => setSheet(null)} actions={sizeActions} />
        <ActionSheet visible={sheet === "start"} onClose={() => setSheet(null)} actions={startActions} />
      </Screen>
    </>
  );
}

function Row(props: { label: string; value: boolean; onChange: (v: boolean) => void; testID: string; border?: boolean }) {
  return (
    <View className={"flex-row items-center justify-between px-4 py-3" + (props.border ? " border-b border-border" : "")}>
      <Text className="flex-1 text-base text-foreground">{props.label}</Text>
      <Switch value={props.value} onValueChange={props.onChange} testID={props.testID} />
    </View>
  );
}
