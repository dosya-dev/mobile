import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatBytes } from "@/lib/format";
import { rtlLine, useT } from "@/lib/i18n";
import { FileRow } from "@/files/FileRow";
import type { FileListPage } from "@/files/types";
import { useOfflineStore } from "@/offline/offlineStore";
import { runOfflineSync } from "@/offline/sync";
import { unpin } from "@/offline/pins";
import { offlineListing } from "@/offline/read";
import { loadPinSummaries, pinStatusLine, summaryFor, type PinSummary } from "@/offline/ui/pinStatus";
import type { PinRow } from "@/offline/types";

/**
 * Everything kept on this phone, and the one place that always opens it.
 *
 * Reads the offline database only, so it works with no connection at all.
 * Files open with origin "offline": the saved copy, never a replacement
 * fetched on the user's behalf (the plan's "Viewer behaviour"). A pinned folder
 * browses from the phone too - this same screen with `folderId` set.
 */
export default function OfflineScreen() {
  const params = useLocalSearchParams<{ folderId?: string; workspaceId?: string; name?: string }>();
  if (params.folderId && params.workspaceId) {
    return <OfflineFolder folderId={params.folderId} workspaceId={params.workspaceId} name={params.name ?? ""} />;
  }
  return <OfflinePins />;
}

function openFile(router: ReturnType<typeof useRouter>, id: string) {
  router.push({ pathname: "/file/[id]", params: { id, origin: "offline" } });
}

function OfflinePins() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const pins = useOfflineStore((s) => s.pins);
  const progress = useOfflineStore((s) => s.progress);
  const [summaries, setSummaries] = useState<Map<string, PinSummary>>(() => new Map());
  const [syncing, setSyncing] = useState(false);

  // Counts and sizes follow the pins: every change to them comes through a
  // store refresh, which hands this a new array.
  useEffect(() => {
    let live = true;
    loadPinSummaries()
      .then((m) => { if (live) setSummaries(m); })
      .catch(() => {});
    return () => { live = false; };
  }, [pins]);
  useEffect(() => { void useOfflineStore.getState().refresh(); }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await runOfflineSync({ reason: "manual" });
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  const open = (pin: PinRow) => {
    if (pin.status === "gone") return;
    if (pin.kind === "file") openFile(router, pin.id);
    else router.push({ pathname: "/offline", params: { folderId: pin.id, workspaceId: pin.workspace_id, name: pin.name } });
  };

  const busy = syncing || progress !== null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("offline.heading.offline") }} />
      <FlatList
        testID="offline-pins"
        data={pins}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ flexGrow: 1 }}
        ListHeaderComponent={
          <View className="gap-3 px-5 pb-3 pt-4">
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("offline.description.weKeepTheseOnThisPhone")}
            </Text>
            <View className="flex-row items-center gap-3">
              <Pressable
                testID="offline-sync-now"
                accessibilityRole="button"
                accessibilityState={{ disabled: busy, busy }}
                disabled={busy}
                onPress={() => { void syncNow(); }}
                className={"flex-row items-center gap-2 rounded-lg bg-secondary px-3 py-2" + (busy ? " opacity-60" : "")}
              >
                {busy ? <ActivityIndicator size="small" color={tokens.mutedForeground} /> : <Icon name="refresh" size={16} color={tokens.foreground} />}
                <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("offline.action.syncNow")}</Text>
              </Pressable>
              {progress ? (
                <Text testID="offline-progress" className="flex-1 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }} numberOfLines={2}>
                  {t("offline.status.progressFiles", {
                    done: progress.done,
                    total: progress.total,
                    bytesDone: formatBytes(progress.bytesDone),
                    bytesTotal: formatBytes(progress.bytesTotal),
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const summary = summaryFor(summaries, item.id);
          const gone = item.status === "gone";
          const status = pinStatusLine(item, summary);
          return (
            <View className="flex-row items-center gap-3 border-b border-border px-5 py-3">
              <Pressable
                testID={`offline-pin-${item.id}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: gone }}
                disabled={gone}
                onPress={() => open(item)}
                className="min-w-0 flex-1 flex-row items-center gap-3"
              >
                <Icon name={item.kind === "folder" ? "folder" : "document-outline"} size={24} color={gone ? tokens.mutedForeground : tokens.foreground} />
                <View className="min-w-0 flex-1">
                  <Text className={"text-base " + (gone ? "text-muted-foreground" : "text-foreground")} numberOfLines={1}>{item.name}</Text>
                  <Text testID={`offline-pin-status-${item.id}`} className="text-xs text-muted-foreground" numberOfLines={2}>
                    {gone ? status : rtlLine(`${formatBytes(summary.bytes)} · ${status}`)}
                  </Text>
                  {/* "Waiting for Wi-Fi" is also what a phone on a VPN sees: iOS
                      reports that network as unknown, which could as well be
                      cellular, so we do not guess. Point at the way out. */}
                  {item.status === "waiting_wifi" ? (
                    <Text testID={`offline-pin-wifi-hint-${item.id}`} className="text-xs text-muted-foreground" numberOfLines={2}>
                      {t("offline.status.notOnWiFiAllowMobileData")}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                testID={`offline-pin-remove-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t("offline.action.removeNameFromOffline", { name: item.name })}
                hitSlop={8}
                onPress={() => { void unpin(item.id); }}
                className="rounded-lg bg-secondary px-3 py-1.5"
              >
                <Text className="text-sm text-foreground">{t("common.remove")}</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View testID="offline-empty" className="flex-1 items-center justify-center px-8 py-16">
            <Icon name="arrow-down-circle" size={32} color={tokens.mutedForeground} />
            <Text className="mt-3 text-center text-base text-foreground" style={{ fontFamily: fonts.medium }}>
              {t("offline.empty.nothingIsAvailableOfflineYet")}
            </Text>
            <Text className="mt-1 text-center text-xs text-muted-foreground">
              {t("offline.description.openTheMenuOnAFileOrFolderAndChooseMakeAvailableOffline")}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function OfflineFolder({ folderId, workspaceId, name }: { folderId: string; workspaceId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const [page, setPage] = useState<FileListPage | null | undefined>(undefined);
  // The listing follows the store: a sync that adds or removes files refreshes it.
  const pins = useOfflineStore((s) => s.pins);
  const saved = useOfflineStore((s) => s.savedFileIds);

  useEffect(() => {
    let live = true;
    offlineListing(workspaceId, folderId)
      .then((p) => { if (live) setPage(p); })
      .catch(() => { if (live) setPage(null); });
    return () => { live = false; };
  }, [workspaceId, folderId, pins, saved]);

  const rows = [
    ...(page?.folders ?? []).map((f) => ({ type: "folder" as const, item: f })),
    ...(page?.files ?? []).map((f) => ({ type: "file" as const, item: f })),
  ];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: name || t("offline.heading.offline") }} />
      {page === undefined ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      ) : (
        <FlatList
          testID="offline-folder"
          data={rows}
          keyExtractor={(r) => r.type + ":" + r.item.id}
          renderItem={({ item }) => item.type === "folder"
            ? (
              // Not FolderRow: the phone does not know a subfolder's item
              // count, and FolderRow would print a confident "0 items".
              <Pressable
                testID={`offline-subfolder-${item.item.id}`}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/offline", params: { folderId: item.item.id, workspaceId, name: item.item.name } })}
                className="flex-row items-center gap-3 border-b border-border px-5 py-3"
              >
                <Icon name="folder" size={26} color={tokens.foreground} />
                <Text className="flex-1 text-base text-foreground" numberOfLines={1}>{item.item.name}</Text>
                <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />
              </Pressable>
            )
            : <FileRow file={item.item} onPress={() => openFile(router, item.item.id)} />}
          ListEmptyComponent={
            <Text testID="offline-folder-empty" className="mt-8 px-8 text-center text-muted-foreground">
              {page === null ? t("offline.description.thisFolderIsNoLongerOnThisPhone") :t("files.description.thisFolderIsEmpty")}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
