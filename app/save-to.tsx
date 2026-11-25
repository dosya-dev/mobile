import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { FolderRow } from "@/files/FolderRow";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces, useFileList } from "@/files/hooks";
import { formatBytes } from "@/files/format";
import { useUploadStore } from "@/upload/store";
import { startUploads } from "@/upload/controller";
import { useShareIntentStore } from "@/share-intent/store";
import { toUploadDrafts } from "@/share-intent/copy";
import { discardSharedFiles } from "@/share-intent/incoming";
import type { SharedFile } from "@/share-intent/types";
import { useT } from "@/lib/i18n";

type Crumb = { id: string | null; name: string };

/**
 * Destination picker for files handed to the app by Android's "Open with"
 * chooser or share sheet (see modules/dosya-share-intent).
 *
 * Deliberately not merged with app/pick-destination.tsx despite the visual
 * similarity: that screen moves or copies a file that is already in a workspace,
 * so it is scoped to the active one and can only descend. This one is an entry
 * point from outside the app - the user has no idea where they are, may not have
 * opened dosya.dev in weeks, and must be able to reach any workspace and back
 * out of a wrong turn without returning to the app they shared from.
 */
export default function SaveTo() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();

  // Taken ONCE, on first render. take() empties the store, so reading it during
  // render would blank the screen the moment anything re-rendered - and the
  // folder list re-renders as soon as its query resolves. A ref rather than a
  // lazy useState initialiser because React may invoke that initialiser twice.
  const taken = useRef<SharedFile[] | null | undefined>(undefined);
  if (taken.current === undefined) taken.current = useShareIntentStore.getState().take();
  const files = taken.current;

  // True from the moment Save is tapped until the copy settles. Read by the
  // unmount cleanup below so leaving mid-copy does not delete a source that
  // copyAsync is still reading.
  const saving = useRef(false);
  useEffect(() => {
    const handed = taken.current;
    return () => {
      // Leaving without saving is the one path where nothing else touches the
      // originals iOS copied into Documents/Inbox. Apple leaves their deletion
      // to the app, and the save path (copy.ts) only deletes what it copied.
      // Android content:// handles are skipped inside discardSharedFiles.
      if (saving.current || !handed || handed.length === 0) return;
      void discardSharedFiles(handed);
    };
  }, []);

  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  // Only the user's explicit choice is stored; the default is DERIVED on every
  // render. Seeding useState from activeId instead would freeze whatever was
  // available on the first render - and if the workspaces query had not resolved
  // by then, that is null, leaving Save disabled for the life of the screen with
  // nothing the user can do about it.
  const [chosen, setChosen] = useState<string | null>(null);
  const workspaceId = chosen ?? activeId;
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [busy, setBusy] = useState(false);

  const folderId = trail.length > 0 ? trail[trail.length - 1].id : null;
  const q = useFileList(workspaceId, folderId, "all", "name_asc");
  const folders = (q.data?.pages ?? []).flatMap((p) => p.folders);

  if (!files || files.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: true, title: t("upload.heading.saveToDosyaDev") }} />
        <View testID="save-to-empty" className="flex-1 items-center justify-center gap-3 px-10">
          <Icon name="document-outline" size={40} color={tokens.mutedForeground} />
          <Text className="text-center text-base text-foreground">{t("upload.label.nothingToSave")}</Text>
          <Text className="text-center text-sm text-muted-foreground">
            {t("upload.description.shareAFileFromAnotherAppToSaveItHere")}
          </Text>
          <Button title={t("upload.action.goToMyFiles")} variant="ghost" onPress={() => router.replace("/")} />
        </View>
      </SafeAreaView>
    );
  }

  const totalBytes = files.reduce((n, f) => n + (f.size > 0 ? f.size : 0), 0);

  const pickWorkspace = (id: string) => {
    if (id === workspaceId) return;
    setChosen(id);
    // A folder id belongs to exactly one workspace. Carrying the old selection
    // across would target a folder the new workspace does not own, and the
    // server rejects it - surfacing as a failed upload with no visible cause.
    setTrail([]);
  };

  const save = async () => {
    if (busy || !workspaceId) return;
    // Copying a large file is slow enough to double-tap through, and a second
    // pass would enqueue a duplicate set of drafts for the same file.
    setBusy(true);
    saving.current = true;
    try {
      const { drafts, failed } = await toUploadDrafts(files);

      if (drafts.length > 0) {
        useUploadStore.getState().enqueue(
          drafts.map((d) => ({
            ...d,
            folderId,
            workspaceId,
          })),
        );
        startUploads();
      }

      if (failed.length > 0) {
        // Named, not counted. "1 file failed" leaves the user guessing which of
        // the five they shared is missing from their workspace.
        toast(t("upload.error.couldnTReadFiles", { files: failed.join(", ") }), "error");
      }

      if (drafts.length === 0) {
        // Everything failed. Staying put lets the user retry; navigating away
        // would drop them into a file list with nothing new in it.
        return;
      }

      toast(t("upload.status.savingCountPluralOneFileOtherFiles", { count: drafts.length }));
      // replace, not push: this screen's share is spent, and back should return
      // to the app the user shared from rather than to an empty picker.
      router.replace("/");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("upload.error.couldnTSaveTheFile"), "error");
    } finally {
      setBusy(false);
      saving.current = false;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("upload.heading.saveToDosyaDev") }} />

      <View className="border-b border-border px-5 py-4">
        {files.slice(0, 3).map((f, i) => (
          // Index in the key: sharing the same file twice in one batch is
          // possible, and two identical uris would collide.
          <View key={`${f.uri}-${i}`} className="flex-row items-center gap-3 py-1">
            <Icon name="document-outline" size={20} color={tokens.mutedForeground} />
            <Text className="flex-1 text-base text-foreground" numberOfLines={1}>{f.name}</Text>
          </View>
        ))}
        <Text className="mt-1 text-xs text-muted-foreground">
          {files.length > 3 ? `${t("upload.label.filescountFiles", { filesCount: files.length })} ` : ""}{formatBytes(totalBytes)}
        </Text>
      </View>

      {(workspaces.data?.length ?? 0) > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="border-b border-border"
          contentContainerClassName="gap-2 px-5 py-3"
        >
          {(workspaces.data ?? []).map((w) => (
            <Pressable
              key={w.id}
              testID={`pick-workspace-${w.id}`}
              onPress={() => pickWorkspace(w.id)}
              className={`rounded-full border px-3 py-1.5 ${
                w.id === workspaceId ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <Text className={w.id === workspaceId ? "text-sm text-primary" : "text-sm text-muted-foreground"}>
                {w.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="border-b border-border"
        contentContainerClassName="items-center gap-1 px-5 py-2"
      >
        <Pressable testID="crumb-root" onPress={() => setTrail([])}>
          <Text className={trail.length === 0 ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
            {workspaces.data?.find((w) => w.id === workspaceId)?.name ?? t("common.label.files")}
          </Text>
        </Pressable>
        {trail.map((c, i) => (
          <View key={c.id ?? i} className="flex-row items-center gap-1">
            <Icon name="chevron-forward" size={14} color={tokens.mutedForeground} />
            <Pressable testID={`crumb-${c.id}`} onPress={() => setTrail(trail.slice(0, i + 1))}>
              <Text className={i === trail.length - 1 ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
                {c.name}
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <FlatList
        data={folders}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => (
          <FolderRow folder={item} onPress={() => setTrail([...trail, { id: item.id, name: item.name }])} />
        )}
        ListEmptyComponent={<Text className="mt-8 text-center text-muted-foreground">{t("common.label.noSubFolders")}</Text>}
      />

      <View className="p-4">
        <Button
          title={trail.length === 0 ? t("common.action.saveHere") : t("upload.action.saveToName", { name: trail[trail.length - 1].name })}
          onPress={() => { void save(); }}
          loading={busy}
          disabled={!workspaceId}
          testID="confirm-save-to"
        />
      </View>
    </SafeAreaView>
  );
}
