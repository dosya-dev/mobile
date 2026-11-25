import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces } from "@/files/hooks";
import { getTrash } from "@/files/api";
import { deleteFile, deleteFolder, restoreFile, restoreFolder } from "@/files/mutations";
import { usePermissions } from "@/workspace/usePermissions";
import { FolderIcon } from "@/files/FolderIcon";
import { formatBytes, formatDate } from "@/files/format";
import { purgeSequence, describePurgeReport } from "@/files/purge";
import { purgeTrashedFolder } from "@/files/folderPurge";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import type { FileItem, FileListPage, FolderItem } from "@/files/types";
import { rtlLine, useT } from "@/lib/i18n";
import { byteCount } from "@/lib/format-locale";

type Pending =
  | { kind: "file"; file: FileItem }
  | { kind: "folder"; folder: FolderItem }
  | { kind: "all"; count: number };

type Row = { type: "folder"; item: FolderItem } | { type: "file"; item: FileItem };

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * The trash, as the web files page shows it. Folders the user deleted are
 * rows of their own (with the files that went with them collapsed into the
 * count and size), tapping one browses into it on a new screen, and the list
 * pages like every other listing. Restore and Delete permanently sit on every
 * row the role may delete; inside a trashed folder the server decides what a
 * descendant may do and its message is what the user sees.
 *
 * A second DELETE on an already-trashed file is what purges it from D1 and
 * R2, the same endpoint that trashed it; a trashed folder's DELETE is a
 * bounded purge that is looped until it reports complete (lib/folderPurge).
 */
export default function TrashScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ folderId?: string; name?: string }>();
  const folderId = params.folderId ?? null;
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const { can, userId } = usePermissions();

  const q = useInfiniteQuery({
    queryKey: ["files", ws, "deleted", folderId],
    enabled: !!ws,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getTrash(ws as string, { folderId, page: pageParam }),
    getNextPageParam: (last: FileListPage) => (last.pagination.page < last.pagination.total_pages ? last.pagination.page + 1 : undefined),
  });
  const pages = q.data?.pages ?? [];
  const folders = pages.flatMap((p) => p.folders);
  const files = pages.flatMap((p) => p.files);
  const rows: Row[] = [
    ...folders.map((f) => ({ type: "folder" as const, item: f })),
    ...files.map((f) => ({ type: "file" as const, item: f })),
  ];

  // Same rule as the web trash and the server's restore/purge: delete_any_file
  // covers everything, delete_own_files only what this member put there.
  const canDeleteFile = (f: FileItem) => can("delete_any_file") || (can("delete_own_files") && f.uploaded_by === userId);
  const canDeleteFolder = (f: FolderItem) => can("delete_any_file") || (can("delete_own_files") && f.created_by === userId);

  const [pending, setPending] = useState<Pending | null>(null);
  const [purging, setPurging] = useState(false);
  const [restoring, setRestoring] = useState<Set<string>>(() => new Set());

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["files"] });
    await q.refetch();
  };

  const guardRestore = async (id: string, run: () => Promise<void>) => {
    if (restoring.has(id)) return;
    setRestoring((prev) => new Set(prev).add(id));
    try {
      await run();
    } finally {
      setRestoring((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const onRestoreFile = (f: FileItem) => guardRestore(f.id, async () => {
    try {
      await restoreFile(f.id);
      toast(t("common.status.restored"));
      await refresh();
    } catch (e) {
      // The 409 "restore the folder first" and name-clash messages are the
      // useful part; a generic failure would hide them.
      toast(errorMessage(e, t("files.error.theFileCouldNotBeMoved")), "error");
    }
  });

  const onRestoreFolder = (f: FolderItem) => guardRestore(f.id, async () => {
    try {
      const res = await restoreFolder(f.id);
      const name = res.name ?? f.name;
      toast(res.restored_to_root
        ? t("files.feedback.restorednameRestoredToTheWorkspaceRootItsOriginalFolderIs", { restoredName: name })
        : t("files.feedback.restorednameRestored", { name }));
      await refresh();
    } catch (e) {
      toast(errorMessage(e, t("files.error.theFolderCouldNotBeRestored")), "error");
    }
  });

  /** Every trash root in the workspace, not just the pages loaded so far. */
  const everything = async (): Promise<{ folderIds: string[]; fileIds: string[] }> => {
    const folderIds: string[] = [];
    const fileIds: string[] = [];
    let page = 1;
    for (;;) {
      const p = await getTrash(ws as string, { folderId: null, page });
      folderIds.push(...p.folders.map((f) => f.id));
      fileIds.push(...p.files.map((f) => f.id));
      if (p.pagination.page >= p.pagination.total_pages) break;
      page = p.pagination.page + 1;
    }
    return { folderIds, fileIds };
  };

  const runPurge = async (target: Pending) => {
    setPurging(true);
    try {
      const ids = target.kind === "all"
        ? await everything()
        : target.kind === "file" ? { folderIds: [], fileIds: [target.file.id] } : { folderIds: [target.folder.id], fileIds: [] };
      const folderReport = await purgeSequence(ids.folderIds, async (id) => {
        const outcome = await purgeTrashedFolder(() => deleteFolder(id));
        if (!outcome.complete) throw new Error("incomplete");
      }, { concurrency: 1 });
      const fileReport = await purgeSequence(ids.fileIds, async (id) => { await deleteFile(id); });
      const report = {
        outcomes: [...folderReport.outcomes, ...fileReport.outcomes],
        succeeded: [...folderReport.succeeded, ...fileReport.succeeded],
        failed: [...folderReport.failed, ...fileReport.failed],
      };
      toast(describePurgeReport(report), report.failed.length ? "error" : undefined);
    } finally {
      setPurging(false);
      setPending(null);
      await refresh();
    }
  };

  const confirmCopy = (): { title: string; message: string; label: string } => {
    if (pending?.kind === "file") {
      return {
        title: t("files.heading.deletePermanently"),
        message: t("trash.description.nameWillBeRemovedFromStorageThisCannotBeUndone", { name: pending.file.name }),
        label: t("common.delete"),
      };
    }
    if (pending?.kind === "folder") {
      return {
        title: t("files.heading.deletePermanently"),
        message: t("files.error.permanentlyDeleteDeletetargetnameHasfilesThisCannotBeUndone", {
          deleteTargetName: pending.folder.name,
          hasFiles: pending.folder.file_count > 0 ? "true" : "false",
          fileCount: pending.folder.file_count,
        }),
        label: t("files.action.deletePermanently"),
      };
    }
    const n = pending?.kind === "all" ? pending.count : 0;
    return {
      title: t("trash.heading.emptyTrash"),
      message: t("trash.description.nPluralOneItemOtherItemsWillBeRemovedFromStorageThisCannotBe", { n }),
      label: t("common.action.deleteCount", { count: byteCount(n) }),
    };
  };
  const copy = confirmCopy();

  const openFolder = (f: FolderItem) => router.push({ pathname: "/trash", params: { folderId: f.id, name: f.name } });

  const total = (pages[0]?.pagination.total_files ?? 0) + folders.length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: folderId ? (params.name ?? t("trash.heading.trash")) : t("trash.heading.trash"),
          headerRight: () =>
            !folderId && rows.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("trash.action.emptyTrash")}
                testID="empty-trash"
                hitSlop={8}
                onPress={() => setPending({ kind: "all", count: Math.max(total, rows.length) })}
              >
                <Text className="text-sm text-destructive">{t("trash.action.empty")}</Text>
              </Pressable>
            ) : null,
        }}
      />

      {!folderId ? (
        <View className="border-b border-border bg-secondary/40 px-5 py-2">
          <Text className="text-xs text-muted-foreground">{t("files.description.itemsInTheTrashStillCountAgainstYourStorage")}</Text>
        </View>
      ) : null}

      <FlatList
        testID="trash-list"
        data={rows}
        keyExtractor={(r) => r.type + ":" + r.item.id}
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        renderItem={({ item }) => {
          if (item.type === "folder") {
            const f = item.item;
            const actionable = f.is_trash_root === true && canDeleteFolder(f);
            const size = f.trashed_size_bytes ?? 0;
            return (
              <Pressable
                onPress={() => openFolder(f)}
                accessibilityRole="button"
                className="flex-row items-center gap-3 px-5 py-3 border-b border-border"
                testID={`trash-folder-${f.id}`}
              >
                <FolderIcon folder={f} size={26} />
                <View className="flex-1">
                  <Text className="text-base text-foreground" numberOfLines={1}>{f.name}</Text>
                  <Text className="text-xs text-muted-foreground">
                    {rtlLine(size > 0 ? `${t("common.label.item", { count: f.file_count })} · ${formatBytes(size)}` : t("common.label.item", { count: f.file_count }))}
                  </Text>
                </View>
                {actionable ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("trash.action.restoreName", { name: f.name })}
                      disabled={restoring.has(f.id)}
                      onPress={() => void onRestoreFolder(f)}
                      testID={`restore-folder-${f.id}`}
                      hitSlop={8}
                      className="px-1"
                    >
                      <Icon name="arrow-undo" size={20} color={tokens.primary} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("trash.action.deleteNamePermanently", { name: f.name })}
                      onPress={() => setPending({ kind: "folder", folder: f })}
                      testID={`purge-folder-${f.id}`}
                      hitSlop={8}
                      className="px-1"
                    >
                      <Icon name="trash" size={20} color={tokens.destructive} />
                    </Pressable>
                  </>
                ) : (
                  <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />
                )}
              </Pressable>
            );
          }
          const f = item.item;
          const actionable = canDeleteFile(f);
          return (
            <View className="flex-row items-center gap-3 px-5 py-3 border-b border-border">
              <Icon name="document" size={22} color={tokens.mutedForeground} />
              <View className="flex-1">
                <Text className="text-base text-foreground" numberOfLines={1}>{f.name}</Text>
                <Text className="text-xs text-muted-foreground">{rtlLine(`${formatBytes(f.size_bytes)} · ${formatDate(f.created_at)}`)}</Text>
              </View>
              {actionable ? (
                <>
                  {/* Restore stays the primary action and keeps the accent colour;
                      permanent delete is destructive and reads as such. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("trash.action.restoreName", { name: f.name })}
                    disabled={restoring.has(f.id)}
                    onPress={() => void onRestoreFile(f)}
                    testID={`restore-${f.id}`}
                    hitSlop={8}
                    className="px-1"
                  >
                    <Icon name="arrow-undo" size={20} color={tokens.primary} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("trash.action.deleteNamePermanently", { name: f.name })}
                    onPress={() => setPending({ kind: "file", file: f })}
                    testID={`purge-${f.id}`}
                    hitSlop={8}
                    className="px-1"
                  >
                    <Icon name="trash" size={20} color={tokens.destructive} />
                  </Pressable>
                </>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          q.isLoading ? <ActivityIndicator className="mt-8" color={tokens.primary} /> : (
            <Text className="text-center text-muted-foreground mt-8">{t("trash.label.trashIsEmpty")}</Text>
          )
        }
        ListFooterComponent={q.isFetchingNextPage ? <View className="py-4"><ActivityIndicator color={tokens.primary} /></View> : null}
      />

      {purging ? (
        <View className="absolute inset-0 items-center justify-center bg-background/70">
          <ActivityIndicator color={tokens.primary} />
          <Text className="mt-2 text-sm text-muted-foreground" testID="purging">{t("trash.status.deleting")}</Text>
        </View>
      ) : null}

      <ConfirmDialog
        visible={pending !== null && !purging}
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.label}
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => { if (pending) void runPurge(pending); }}
      />
    </SafeAreaView>
  );
}
