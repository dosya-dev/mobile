import { translateExternal } from "@/lib/external-text";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { formatBytes, fileKind } from "@/files/format";
import { saveToDevice, saveOutcomeMessage, SaveCancelled } from "@/files/saveToDevice";
import { shareFile } from "@/files/download";
import { ImageStage } from "@/viewer/stages/ImageStage";
import { VideoStage } from "@/viewer/stages/VideoStage";
import { StageMessage } from "@/viewer/stages/StageMessage";
import { stagePalette } from "@/viewer/stageTheme";
import { useVault } from "@/vault/store";
import type { VaultEntry } from "@/vault/engine";
import { TransferBar } from "@/vault/ui/TransferBar";
import { mimeFromName, extOf } from "@/vault/ui/mime";
import { useT } from "@/lib/i18n";

/**
 * One Vault file, full-bleed on the viewer's dark stage.
 *
 * The bytes are decrypted into the app's cache first - nothing here streams
 * from a URL, because there is no URL the OS could fetch that would not be
 * ciphertext. lock() wipes that cache, so the copy cannot outlive the session.
 */
export default function VaultFileScreen() {
  const t = useT();
  const { spaceId, folderId, entryId, name, size } = useLocalSearchParams<{
    spaceId: string; folderId: string; entryId: string; name: string; size?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = stagePalette("dark");
  const status = useVault((s) => s.status);
  const transfers = useVault((s) => s.transfers);
  const error = useVault((s) => s.error);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The copy the player has reported a duration for, which is the only proof
  // that it really opened it. Without it the stage's stall timer replaces a
  // playing video with "still loading".
  const [openedUri, setOpenedUri] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const parsedSize = Number.parseInt(size ?? "", 10);
  const entry: VaultEntry = useMemo(
    () => ({ id: entryId, name, kind: "file", size: Number.isFinite(parsedSize) ? parsedSize : null, timestamp: 0 }),
    [entryId, name, parsedSize],
  );

  /**
   * One download per file, however many times the effect is invoked.
   *
   * The ref holds the RUN, not just a "started" flag: StrictMode invokes an
   * effect twice, cleaning up in between, so a flag alone would start the
   * download on the first pass and then throw its result away with that
   * pass's cleanup. Every invocation subscribes to the same promise instead,
   * and two sinks on one cache path - a corrupted file, not a slow one -
   * never happen. Keyed by the target, so a genuine change of file still
   * downloads.
   */
  const started = useRef<{ target: string; run: Promise<string | null> } | null>(null);

  // Locked under this screen (the background lock, a sign-out): there is
  // nothing to show and no action that can work, and the cache this stage
  // reads from has just been wiped. The Vault index owns the gate.
  useEffect(() => {
    if (status !== "unlocked") router.replace("/vault");
  }, [status, router]);

  // The Space has to be the open one before the bytes are asked for: the cache
  // path is keyed by it, and the engine serves from whichever Space is open.
  useEffect(() => {
    if (status !== "unlocked") return;
    const target = `${spaceId}/${folderId}/${entryId}`;
    if (started.current?.target !== target) {
      started.current = {
        target,
        run: (async () => {
          const store = useVault.getState();
          if (store.activeSpaceId !== spaceId && !(await store.openSpace(spaceId))) return null;
          return useVault.getState().downloadToCache(folderId, entry);
        })(),
      };
    }
    let cancelled = false;
    void started.current.run.then((uri) => {
      if (cancelled) return;
      setLocalUri(uri);
      // A null uri with no transfer row (no open Space, for one) used to leave
      // the stage spinning for ever.
      setFailed(uri === null);
    });
    return () => { cancelled = true; };
  }, [spaceId, folderId, entryId, entry, status]);

  const mimeType = mimeFromName(name);
  const extension = extOf(name);
  const kind = fileKind(mimeType, extension);

  const save = async () => {
    if (!localUri) return;
    try {
      const outcome = await saveToDevice({ localUri, fileName: name, mimeType, extension, sizeBytes: entry.size ?? 0 });
      toast(saveOutcomeMessage(outcome));
    } catch (e) {
      // Backing out of the picker or the permission prompt is a choice.
      if (e instanceof SaveCancelled) return;
      toast(e instanceof Error ? translateExternal(e.message) : t("common.error.couldnTSaveThisFile"), "error");
    }
  };

  const share = async () => {
    if (!localUri) return;
    try {
      await shareFile(localUri);
    } catch (e) {
      toast(e instanceof Error ? translateExternal(e.message) : t("common.error.couldnTShareThisFile"), "error");
    }
  };

  // This file's own download, not everything in flight: an upload still
  // running in the folder behind this screen is not what the stage is waiting
  // for, and its Retry belongs to the browser that started it. Matched on the
  // id the store mints for a download, so two files of the same name cannot
  // borrow each other's row.
  const ownTransfer = transfers[`dl-${entryId}`];
  const ownTransfers = ownTransfer ? [ownTransfer] : [];

  const stage = !localUri ? (
    failed || error ? (
      <StageMessage
        testID="vault-file-error"
        icon="alert-circle-outline"
        title={name}
        // The store's sentence when it has one; it does not always, so this
        // screen owns the one case where nothing set an error at all.
        body={error ?? t("vault.error.couldnTOpenThisFile")}
        actions={[{ testID: "vault-file-error-back", icon: "chevron-back", label: t("common.back"), onPress: () => router.back() }]}
      />
    ) : (
    <View className="flex-1 items-center justify-center px-6">
      {ownTransfers.length > 0 ? (
        <View className="w-full">
          <TransferBar
            transfers={ownTransfers}
            // A download carries nothing to retry with; only an upload does.
            onRetry={() => {}}
            onDismiss={(id) => useVault.getState().dismissTransfer(id)}
          />
        </View>
      ) : (
        <ActivityIndicator color={palette.fgMuted} />
      )}
    </View>
    )
  ) : kind === "image" ? (
    <ImageStage uri={localUri} palette={palette} />
  ) : kind === "video" ? (
    <VideoStage
      uri={localUri}
      mimeType={mimeType}
      extension={extension}
      onDuration={() => setOpenedUri(localUri)}
      playing={openedUri === localUri}
      onSave={() => void save()}
    />
  ) : (
    <StageMessage
      testID="vault-file-stage-message"
      icon="document-outline"
      title={name}
      // Nothing rather than "0 B" when the listing carried no size.
      body={entry.size === null ? "" : formatBytes(entry.size)}
      actions={[
        { testID: "vault-file-stage-save", icon: "download-outline", label: t("common.action.saveToDevice"), onPress: () => void save() },
        { testID: "vault-file-stage-share", icon: "share-outline", label: t("common.action.share"), onPress: () => void share() },
      ]}
    />
  );

  return (
    <View className="flex-1" style={{ backgroundColor: palette.bg }}>
      {/* The stage runs under the status bar, so the chrome brings its own
          insets rather than sitting in a SafeAreaView that would letterbox it. */}
      <View className="flex-row items-center px-3 pb-2" style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          testID="vault-file-back"
          accessibilityRole="button"
          accessibilityLabel={t("common.action.goBack")}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: palette.chrome }}
          onPress={() => router.back()}
        >
          <Icon name="chevron-back" size={22} color={palette.fg} />
        </Pressable>
        <Text className="ms-3 flex-1 text-base" numberOfLines={1} style={{ color: palette.fg }}>{name}</Text>
      </View>

      <View className="flex-1">{stage}</View>

      <View
        className="flex-row items-center justify-around border-t px-4 pt-3"
        style={{ borderTopColor: palette.hairline, paddingBottom: insets.bottom + 12 }}
      >
        <StageButton testID="vault-file-save" icon="download-outline" label={t("vault.label.saveToDevice")} color={palette.fg} onPress={() => void save()} />
        <StageButton testID="vault-file-share" icon="share-outline" label={t("common.action.share")} color={palette.fg} onPress={() => void share()} />
        <StageButton testID="vault-file-delete" icon="trash-outline" label={t("common.delete")} color={palette.fg} onPress={() => setConfirmingDelete(true)} />
      </View>

      <ConfirmDialog
        visible={confirmingDelete}
        title={t("groups.heading.deleteDeleteTargetName", { deleteTargetName: name })}
        message={t("vault.description.thisCannotBeUndone")}
        confirmLabel={t("common.delete")}
        destructive
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          void (async () => {
            if (await useVault.getState().deleteEntry(folderId, entry)) router.back();
          })();
        }}
      />
    </View>
  );
}

function StageButton(props: { testID: string; icon: IconName; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      className="items-center gap-1 px-3 py-1"
      onPress={props.onPress}
    >
      <Icon name={props.icon} size={22} color={props.color} />
      <Text className="text-xs" style={{ color: props.color }}>{props.label}</Text>
    </Pressable>
  );
}
