// apps/mobile/app/pick-archive-destination.tsx
//
// Where an archive entry or subtree lands in dosya. Modelled on
// pick-destination.tsx (active workspace, descend into folders, one confirm
// button) but deliberately separate: that screen moves or copies a file the
// workspace already holds in one request; this one takes a job parked by the
// archive screen (archiveSaveStore.ts) and, for a folder, drives the server
// one entry at a time through archiveSave.ts - so it also owns the progress
// readout and the Cancel control while that runs.
import { useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { FolderRow } from "@/files/FolderRow";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces, useFileList } from "@/files/hooks";
import { apiRequest } from "@/api/client";
import { runFolderSave } from "@/archive/archiveSave";
import { useArchiveSaveStore, type ArchiveSaveJob } from "@/archive/archiveSaveStore";
import { localDigits } from "@/lib/format-locale";

// The root crumb (id null) has no stored name: its label is produced at render, so it follows the language.
type Crumb = { id: string | null; name: string };

export default function PickArchiveDestination() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();

  // Taken ONCE, on first render. take() empties the store, so reading it during
  // render would blank the screen the moment anything re-rendered. A ref rather
  // than a lazy useState initialiser because React may invoke that twice.
  const taken = useRef<ArchiveSaveJob | null | undefined>(undefined);
  if (taken.current === undefined) taken.current = useArchiveSaveStore.getState().take();
  const job = taken.current;

  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: "" }]);
  const folderId = crumbs[crumbs.length - 1]!.id;
  const q = useFileList(activeId, folderId, "all", "name_asc");
  const folders = (q.data?.pages ?? []).flatMap((p) => p.folders);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);

  const saveEntry = (index: number, destId: string | null, name: string) =>
    apiRequest<{ ok: boolean; file_id: string; name: string; size_bytes: number }>(
      `/api/files/${job!.fileId}/archive/save`,
      { method: "POST", body: { i: index, folder_id: destId, name } },
    );

  // POST /api/folders/batch answers `folders`, one row per requested folder,
  // existing or new, with its id.
  const createFolders = async (parentId: string | null, names: string[]) => {
    const res = await apiRequest<{ ok: boolean; folders: { name: string; parent_id: string | null; id: string }[] }>(
      "/api/folders/batch",
      { method: "POST", body: { workspace_id: activeId, folders: names.map((name) => ({ name, parent_id: parentId })) } },
    );
    return new Map(res.folders.map((r) => [r.name, r.id]));
  };

  const saveHere = async () => {
    if (!job) return;
    setBusy(true);
    try {
      if (job.kind === "entry") {
        const out = await saveEntry(job.index, folderId, job.name);
        toast(t("archive.status.savedNameToDosya", { name: out.name }));
        router.back();
        return;
      }
      cancelRef.current = false;
      setProgress({ done: 0, total: job.plan.files.length });
      const out = await runFolderSave(job.plan, folderId, {
        createFolders,
        saveEntry,
        onProgress: (done, total) => setProgress({ done, total }),
        isCancelled: () => cancelRef.current,
      });
      const summary = t("archive.status.savedSaved", {
        saved: out.saved,
        folderName: job.plan.rootName,
        hasSkipped: out.skipped ? "true" : "false",
        skipped: localDigits(out.skipped),
        hasFailed: out.failed.length ? "true" : "false",
        failed: localDigits(out.failed.length),
        failedName: out.failed[0]?.name ?? "",
        cancelled: out.cancelled ? "true" : "false",
      });
      if (out.failed.length) toast(summary, "error");
      else toast(summary);
      router.back();
    } catch (err) {
      // The server's own sentence: a refusal (permission, lock, quota) is not a
      // failed transfer, and retrying will not help.
      toast(err instanceof Error && err.message ? err.message : t("archive.error.couldNotSaveIntoDosya"), "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (!job) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: true, title: t("archive.heading.saveTo") }} />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-sm" style={{ color: tokens.mutedForeground }}>
            {t("archive.description.nothingToSaveGoBackToTheArchiveAndChooseAFileOrFolder")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const what = job.kind === "entry"
    ? job.name
    : t("archive.label.foldernameCountPluralOneFileOtherFiles", { folderName: job.plan.rootName, count: job.plan.files.length });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("archive.heading.saveTo") }} />

      <View className="border-b border-border px-5 py-3">
        <Text numberOfLines={1} className="text-xs text-muted-foreground">{t("archive.label.savingWhatFromArchiveName", { what, archiveName: job.archiveName })}</Text>
        <View className="mt-1 flex-row items-center gap-2">
          {crumbs.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("archive.label.upOneFolder")}
              hitSlop={8}
              disabled={busy}
              onPress={() => setCrumbs((c) => c.slice(0, -1))}
              className="h-8 w-8 items-center justify-center"
            >
              <Icon name="chevron-back" size={18} color={tokens.foreground} />
            </Pressable>
          )}
          <Text numberOfLines={1} className="text-base font-semibold text-foreground">
            {crumbs.map((c) => (c.id === null ? t("sync.label.root") : c.name)).join(" / ")}
          </Text>
        </View>
      </View>

      <FlatList
        data={folders}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => (
          <FolderRow folder={item} onPress={() => { if (!busy) setCrumbs((c) => [...c, { id: item.id, name: item.name }]); }} />
        )}
        ListEmptyComponent={<Text className="mt-8 text-center text-muted-foreground">{t("common.label.noSubFolders")}</Text>}
      />

      <View className="p-4">
        {progress ? (
          <View testID="archive-save-progress" className="flex-row items-center justify-between gap-3">
            <Text className="text-sm text-foreground">{t("archive.label.savingDoneOfTotal", { done: localDigits(progress.done), total: localDigits(progress.total) })}</Text>
            <Button title={t("common.cancel")} variant="ghost" onPress={() => { cancelRef.current = true; }} testID="archive-save-cancel" />
          </View>
        ) : (
          <Button title={t("common.action.saveHere")} onPress={() => { void saveHere(); }} loading={busy} testID="archive-save-here" />
        )}
      </View>
    </SafeAreaView>
  );
}
