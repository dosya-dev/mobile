import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, Switch, View } from "react-native";
import { Stack } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { SettingsRow } from "@/ui/SettingsRow";
import { useColorTheme } from "@/theme/useColorTheme";
import { listBackupAlbums, type BackupAlbum } from "@/backup/scanner";
import { ensureAlbumDefaults } from "@/backup/albumDefaults";
import { useBackupSettings } from "@/backup/settings";
import { useT } from "@/lib/i18n";

/**
 * Per-folder switches for what the backup covers.
 *
 * This is the Android headline: MediaStore exposes every image and video any app
 * ever wrote to shared storage, so without this screen a backup sweeps up
 * WhatsApp media, screenshots and downloads alongside the camera roll.
 *
 * Selection is stored as an include list, but "every folder selected" collapses
 * back to albumMode "all" so folders created later are picked up automatically
 * instead of being silently missed by a frozen id list.
 */
export default function BackupFolders() {
  const t = useT();
  const { tokens } = useColorTheme();
  const filters = useBackupSettings((s) => s.settings.filters);
  const updateFilters = useBackupSettings((s) => s.updateFilters);
  const update = useBackupSettings((s) => s.update);
  const [albums, setAlbums] = useState<BackupAlbum[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Camera bucket ids need permission plus an album query, so a fresh
      // install resolves its defaults here rather than at hydrate time.
      await ensureAlbumDefaults();
      const list = await listBackupAlbums();
      if (!alive) return;
      setAlbums(list);
      // Seeing this screen is what the one-time card on the Backup tab was
      // asking for, so it has done its job.
      void update({ filtersMigrated: true });
    })();
    return () => { alive = false; };
  }, [update]);

  const selectedIds = useCallback(
    (all: BackupAlbum[]): string[] =>
      filters.albumMode === "all" ? all.map((a) => a.id) : filters.albumIds,
    [filters],
  );

  const isOn = (id: string, all: BackupAlbum[]) => selectedIds(all).includes(id);

  const toggle = (id: string, on: boolean, all: BackupAlbum[]) => {
    const current = new Set(selectedIds(all));
    if (on) current.add(id);
    else current.delete(id);
    // Everything selected means "all" - that keeps future folders covered.
    if (current.size === all.length) {
      void updateFilters({ albumMode: "all", albumIds: [] });
      return;
    }
    void updateFilters({ albumMode: "include", albumIds: [...current] });
  };

  const total = (albums ?? []).reduce((n, a) => n + a.count, 0);
  const chosen = (albums ?? []).filter((a) => isOn(a.id, albums ?? [])).reduce((n, a) => n + a.count, 0);
  const noneSelected = filters.albumMode === "include" && filters.albumIds.length === 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("backup.heading.deviceFolders") }} />
      <Screen underNativeHeader title={t("backup.heading.deviceFolders")}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <Text className="mb-4 text-sm text-muted-foreground">
            {Platform.OS === "android"
              ? t("backup.description.otherAppsSavePhotosAndVideosToThisDeviceTooChatMediaScreenshotsAnd")
              : t("backup.description.optionalLeaveTheseAloneToBackUpYourWholeLibraryOrNarrowItTo")}
          </Text>

          {noneSelected ? (
            <View testID="no-folders-warning" className="mb-4 flex-row items-start gap-2 rounded-2xl border border-destructive bg-card p-3">
              <Icon name="alert-circle" size={18} color={tokens.destructive} />
              <Text className="flex-1 text-xs text-destructive">
                {t("backup.description.noFoldersSelectedSoNothingWillBeBackedUpTurnAtLeastOneOn")}
              </Text>
            </View>
          ) : null}

          {albums == null ? (
            <Text testID="albums-loading" className="text-sm text-muted-foreground">{t("backup.description.readingYourLibrary")}</Text>
          ) : albums.length === 0 ? (
            <Text testID="no-albums" className="text-sm text-muted-foreground">
              {t("backup.description.noFoldersFoundAllowPhotoAccessToChooseWhatGetsBackedUp")}
            </Text>
          ) : (
            <>
              <View className="rounded-lg border border-border bg-card">
                {albums.map((a, i) => (
                  <SettingsRow
                    key={a.id}
                    label={a.title}
                    description={t("common.label.countItems", { count: a.count.toLocaleString() })}
                    border={i < albums.length - 1}
                    right={
                      <Switch
                        testID={`album-${a.id}`}
                        value={isOn(a.id, albums)}
                        onValueChange={(v) => toggle(a.id, v, albums)}
                      />
                    }
                  />
                ))}
              </View>
              <Text className="mt-3 text-center text-xs text-muted-foreground">
                {t("backup.label.chosenOfTotalItemsSelected", { chosen: chosen.toLocaleString(), total: total.toLocaleString() })}
              </Text>
            </>
          )}
        </ScrollView>
      </Screen>
    </>
  );
}
