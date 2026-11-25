import { useState } from "react";
import { FlatList, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "@/ui/Button";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces, useFileList } from "@/files/hooks";
import { FolderRow } from "@/files/FolderRow";
import { useFileMutations } from "@/files/mutationHooks";
import { describeMoveOutcome, moveItems } from "@/files/bulkMove";
import { useSelectionMoves } from "@/files/selection/selectionMoveStore";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";

const splitIds = (v: string | undefined): string[] => (v ? v.split(",").filter(Boolean) : []);

/**
 * Destination picker for a move/copy.
 *
 * One item: `fileId` or `folderId`. A folder can only be moved (there's no
 * copy-folder endpoint), and the server refuses to move a folder into itself -
 * so the row for the folder being moved is dropped rather than offering a tap
 * that can only fail. Its subtree is still reachable; the server rejects that
 * too and its message is what gets shown.
 *
 * A selection: `fileIds` and `folderIds` (comma-joined), plus `twinIds` for
 * the Live Photo videos that travel with selected stills. Every selected
 * folder is dropped from the list for the same reason, and the move runs the
 * same bulk move the drag-and-drop confirm runs. `moveToken` names the
 * browser's selection: once anything moved it is recorded in
 * useSelectionMoves, and that browser leaves selection mode.
 */
export default function PickDestination() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    fileId?: string;
    folderId?: string;
    fileIds?: string;
    folderIds?: string;
    twinIds?: string;
    moveToken?: string;
    mode: "move" | "copy";
  }>();
  const { fileId, folderId: movingFolderId, mode } = params;
  const selection = params.fileIds !== undefined || params.folderIds !== undefined
    ? { fileIds: splitIds(params.fileIds), folderIds: splitIds(params.folderIds) }
    : null;
  const twinIds = splitIds(params.twinIds);
  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const [folderId, setFolderId] = useState<string | null>(null);
  const q = useFileList(activeId, folderId, "all", "name_asc");
  const mut = useFileMutations();
  const [bulkBusy, setBulkBusy] = useState(false);
  const excluded = new Set(selection ? selection.folderIds : movingFolderId ? [movingFolderId] : []);
  const folders = (q.data?.pages ?? []).flatMap((p) => p.folders).filter((f) => !excluded.has(f.id));

  const isFolder = !!movingFolderId;
  const applyHere = async () => {
    if (selection) {
      setBulkBusy(true);
      try {
        const outcome = await moveItems(selection, folderId, twinIds);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["files"] }),
          queryClient.invalidateQueries({ queryKey: ["library"] }),
        ]);
        const { message, kind } = describeMoveOutcome(outcome, t);
        toast(message, kind);
        // Intentional: selection ends when ANY item moved, even if others failed
        // (the toast names the failures). Keeping a half-stale selection alive
        // would tick rows that are no longer in the folder.
        if (outcome.ok > 0) {
          if (params.moveToken) useSelectionMoves.getState().markMoved(params.moveToken);
          router.back();
        }
      } finally {
        setBulkBusy(false);
      }
      return;
    }
    try {
      if (isFolder) await mut.moveFolder.mutateAsync({ id: movingFolderId as string, parentId: folderId });
      else if (mode === "copy") await mut.copy.mutateAsync({ id: fileId as string, folderId: folderId ?? undefined });
      else await mut.move.mutateAsync({ id: fileId as string, folderId });
      toast(mode === "copy" ? t("common.status.copied") : t("files.status.moved"));
      router.back();
    } catch {
      // useFileMutations' onError has already shown the server's message (e.g. "Cannot move
      // a folder into its own subfolder" - the server owns that check). Swallow here purely
      // so the success toast and back() are skipped.
    }
  };

  const busy = bulkBusy || (isFolder ? mut.moveFolder.isPending : mode === "copy" ? mut.copy.isPending : mut.move.isPending);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: mode === "copy" ? t("files.heading.copyTo") : t("files.heading.moveTo") }} />
      <FlatList
        data={folders}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => <FolderRow folder={item} onPress={() => setFolderId(item.id)} />}
        ListEmptyComponent={<Text className="mt-8 text-center text-muted-foreground">{t("common.label.noSubFolders")}</Text>}
      />
      <View className="p-4">
        <Button
          title={mode === "copy" ? t("files.action.copyHere") : t("files.action.moveHere")}
          onPress={applyHere}
          loading={busy}
          testID="apply-destination"
        />
      </View>
    </SafeAreaView>
  );
}
