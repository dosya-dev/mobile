import { translateExternal } from "@/lib/external-text";
import { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { File } from "expo-file-system";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { PromptDialog } from "@/ui/PromptDialog";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { pickPhotos, pickDocuments, scanDocument } from "@/upload/pickers";
import { scannerAvailable } from "../../../../../modules/dosya-document-scanner";
import { saveToDevice, saveOutcomeMessage, SaveCancelled } from "@/files/saveToDevice";
import { useVault, type Transfer } from "@/vault/store";
import { UnlockCard } from "@/vault/ui/UnlockCard";
import type { VaultEntry } from "@/vault/engine";
import { VaultEntryRow } from "@/vault/ui/VaultEntryRow";
import { TransferBar } from "@/vault/ui/TransferBar";
import { mimeFromName, extOf } from "@/vault/ui/mime";
import { useT } from "@/lib/i18n";

/** One folder inside one Space. The root arrives as folderId="root". */
export default function VaultSpaceFolderScreen() {
  const t = useT();
  const { id, folderId, name } = useLocalSearchParams<{ id: string; folderId: string; name?: string }>();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const status = useVault((s) => s.status);
  const entries = useVault((s) => s.entries);
  const transfers = useVault((s) => s.transfers);
  const error = useVault((s) => s.error);
  // At the root of a Space the title is the SPACE's name, read live from the
  // store rather than the route param: opening a Space reconciles this
  // phone's label with the name the Space itself carries, and that can land a
  // moment after the screen does. A subfolder keeps the param, which is the
  // folder's own name and never changes underneath it.
  const spaceName = useVault((s) => s.spaces.find((sp) => sp.id === id)?.name);
  const title = (folderId === "root" ? spaceName ?? name : name) ?? t("vault.heading.space");
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState(false);
  const [canScan] = useState(scannerAvailable);
  const [actionsFor, setActionsFor] = useState<VaultEntry | null>(null);
  const [deleting, setDeleting] = useState<VaultEntry | null>(null);

  /**
   * On every focus, not just on mount - and again the moment the Vault is
   * unlocked in place below, which is why `status` is a dependency.
   *
   * The store keeps ONE `entries` array for the whole Vault, so walking into a
   * subfolder replaces it - and coming back used to leave the parent showing
   * the child's contents until something else happened to re-list. Clearing
   * first means the window between focus and the new listing shows nothing
   * rather than the wrong folder (a tap in that window navigated with the
   * wrong folderId). Opening the Space first covers a deep link, a
   * back-and-forth between two Spaces, and a re-open after a lock.
   */
  useFocusEffect(
    useCallback(() => {
      if (status !== "unlocked") return;
      let alive = true;
      void (async () => {
        const store = useVault.getState();
        store.clearEntries();
        if (store.activeSpaceId !== id && !(await store.openSpace(id))) return;
        if (!alive) return;
        await useVault.getState().refreshFolder(folderId);
      })();
      return () => { alive = false; };
    }, [id, folderId, status]),
  );

  /** The plaintext copy the picker made in the app's cache, best effort. */
  const forgetCopy = (uri: string) => {
    try {
      new File(uri).delete();
    } catch {
      // A copy the OS already cleaned up, or one it will not let us touch.
      // Losing the delete is not worth losing the upload's outcome over.
    }
  };

  /**
   * One file at a time: a phone has neither the memory nor the sockets for two
   * encrypted streams at once.
   *
   * The copy is deleted only once the ciphertext is actually up. The store
   * arms Retry with that very uri, so deleting it after a FAILED upload armed
   * a button that could not work.
   */
  const upload = async (drafts: { uri: string; name: string }[]) => {
    for (const draft of drafts) {
      if (await useVault.getState().uploadFromUri(folderId, draft.name, draft.uri)) forgetCopy(draft.uri);
    }
  };

  /** The row is handed back to the store, so a retry never mints a second one. */
  const retry = async (transfer: Transfer) => {
    if (!transfer.retry) return;
    const { folderId: target, fileUri } = transfer.retry;
    if (await useVault.getState().uploadFromUri(target, transfer.name, fileUri, transfer.id)) forgetCopy(fileUri);
  };

  /**
   * Dismissing a FAILED upload is the end of that file's road: nothing points
   * at the picker's plaintext copy afterwards, so it goes with the row.
   * (The store cannot do this itself - `expo-file-system` must stay out of it.)
   */
  const dismiss = (transferId: string) => {
    const transfer = useVault.getState().transfers[transferId];
    if (transfer?.retry) forgetCopy(transfer.retry.fileUri);
    useVault.getState().dismissTransfer(transferId);
  };

  const pick = (picker: () => Promise<{ uri: string; name: string }[]>) => {
    void picker()
      .then(upload)
      // A picker that never opens is otherwise a menu item that does nothing.
      .catch(() => toast(t("common.error.couldnTOpenThePicker"), "error"));
  };

  const save = async (entry: VaultEntry) => {
    const localUri = await useVault.getState().downloadToCache(folderId, entry);
    // A failed download already put its own sentence in the transfer row.
    if (!localUri) return;
    try {
      const outcome = await saveToDevice({
        localUri,
        fileName: entry.name,
        mimeType: mimeFromName(entry.name),
        extension: extOf(entry.name),
        sizeBytes: entry.size ?? 0,
      });
      toast(saveOutcomeMessage(outcome));
    } catch (e) {
      // Backing out of the folder picker or the permission prompt is a choice,
      // not a failure.
      if (e instanceof SaveCancelled) return;
      toast(e instanceof Error ? translateExternal(e.message) : t("common.error.couldnTSaveThisFile"), "error");
    }
  };

  const entryActions = (entry: VaultEntry): SheetAction[] => [
    ...(entry.kind === "file"
      ? [{ label: t("vault.action.saveToDevice"), icon: "download-outline" as const, onPress: () => void save(entry) }]
      : []),
    { label: t("common.delete"), icon: "trash-outline", destructive: true, onPress: () => setDeleting(entry) },
  ];

  // Locked under the user's feet (the five-minute background lock, a lock from
  // the Vault index, a sign-out): the gate belongs here rather than an empty
  // listing and an action that fails with "Couldn't ...". Unlocking in place
  // re-opens the Space and re-lists through the focus effect above.
  if (status !== "unlocked") {
    return (
      <View className="flex-1 bg-background px-5 pt-5">
        <Stack.Screen options={{ headerShown: true, title }} />
        <UnlockCard />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerRight: () => (
            <Pressable
              testID="vault-add"
              accessibilityRole="button"
              accessibilityLabel={t("vault.action.addToThisSpace")}
              onPress={() => setAdding(true)}
              android_ripple={{ borderless: true, radius: 20 }}
              className="h-10 w-10 items-center justify-center"
            >
              <Icon name="add" size={24} color={tokens.foreground} />
            </Pressable>
          ),
        }}
      />

      <TransferBar
        transfers={Object.values(transfers)}
        onRetry={(transfer) => void retry(transfer)}
        onDismiss={dismiss}
      />

      {error ? <Text className="px-5 py-3 text-sm text-destructive">{error}</Text> : null}

      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item }) => (
          <VaultEntryRow
            entry={item}
            onPress={() =>
              item.kind === "folder"
                ? router.push({ pathname: "/vault/space/[id]/[folderId]", params: { id, folderId: item.id, name: item.name } })
                : router.push({
                    pathname: "/vault/file",
                    // An unlisted size travels as nothing, never as "0": the
                    // file screen would print "0 B" for a file it simply does
                    // not know the size of.
                    params: { spaceId: id, folderId, entryId: item.id, name: item.name, size: item.size === null ? "" : String(item.size) },
                  })
            }
            onMore={() => setActionsFor(item)}
          />
        )}
        ListEmptyComponent={
          <View testID="vault-folder-empty" className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-muted-foreground">{t("vault.description.thisSpaceIsEmptyAddPhotosOrFilesWithTheButton")}</Text>
          </View>
        }
      />

      <ActionSheet
        visible={adding}
        onClose={() => setAdding(false)}
        actions={[
          { label: t("vault.label.uploadPhotosOrVideos"), icon: "images-outline", onPress: () => pick(pickPhotos) },
          { label: t("vault.label.uploadAFile"), icon: "document-outline", onPress: () => pick(pickDocuments) },
          ...(canScan ? [{ label: t("vault.label.scanADocument"), icon: "scan-outline" as const, onPress: () => pick(scanDocument) }] : []),
          { label: t("common.action.newFolder"), icon: "folder-outline", onPress: () => setNaming(true) },
        ]}
      />

      <ActionSheet
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        actions={actionsFor ? entryActions(actionsFor) : []}
      />

      {naming ? (
        <PromptDialog
          visible
          title={t("upload.heading.newFolder")}
          placeholder={t("vault.error.folderName")}
          confirmLabel={t("common.action.create")}
          onCancel={() => setNaming(false)}
          onSubmit={(folderName) => {
            setNaming(false);
            if (folderName) void useVault.getState().createFolder(folderId, folderName);
          }}
        />
      ) : null}

      <ConfirmDialog
        visible={deleting !== null}
        title={t("groups.heading.deleteDeleteTargetName", { deleteTargetName: deleting?.name ?? "" })}
        message={t("vault.description.thisCannotBeUndone")}
        confirmLabel={t("common.delete")}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void useVault.getState().deleteEntry(folderId, target);
        }}
      />
    </View>
  );
}
