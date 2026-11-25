import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { useT, t as translate } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useAfterDismiss } from "@/ui/afterDismiss";
import { toast } from "@/ui/toast";
import { NewFolderPrompt } from "@/files/NewFolderPrompt";
import { useDownloadStore } from "@/files/downloadStore";
import { cancelDownload } from "@/files/downloadControl";
import { progressCaption, type DownloadEntry } from "@/files/downloadModel";
import { useUploadStore } from "@/upload/store";
import { retryItem } from "@/upload/controller";
import { startFromPicker } from "@/upload/startFromPicker";
import { capturePhoto, pickDocuments, pickPhotos, scanDocument } from "@/upload/pickers";
import { scannerAvailable } from "../../modules/dosya-document-scanner";
import type { UploadItem } from "@/upload/types";
import { usePlayerStore } from "@/player/playerStore";
import { next, stopAndClear, togglePlay } from "@/player/controller";
import { getForTrack, useMetadataStore } from "@/player/metadata/metadataStore";
import { liveDownloads, liveUploads, vaultSummary } from "./orbitModel";
import { useVaultActivity } from "@/vault/status";
import { targetLabel, useUploadTarget } from "./uploadTargetStore";
import { itemErrorText } from "@/upload/uploadError";
import { localDigits } from "@/lib/format-locale";
/**
 * Everything the orbit button stands for, spelled out.
 *
 * The disc can say THAT a track is playing and THAT bytes are moving; it has
 * 56 points to say it in, so it cannot say which track, which file, how fast,
 * or offer a way out. All of that lands here, in the order a thumb reaches it:
 * the transfers that might need cancelling first, then the track, then the
 * upload sources at the bottom where the `+` used to be.
 *
 * This is also the only remaining route to Cancel, which is why the transfers
 * block is live rather than a snapshot taken when the sheet opened.
 */
export function OrbitSheet(props: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const pad = useSheetBottomPad();

  const entries = useDownloadStore((s) => s.entries);
  const items = useUploadStore((s) => s.items);
  const track = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  useMetadataStore((s) => s.entries);
  const target = useUploadTarget();
  // Counts, not names. See `vaultSummary`.
  const vault = useVaultActivity();

  const downs = liveDownloads(Object.values(entries));
  const ups = liveUploads(items);
  const summary = vaultSummary(vault);

  // Rate and estimate come off a clock, so something has to re-render between
  // the throttled progress ticks. Only while the sheet is open and only while
  // something is moving - the same 1s tick the capsule ran.
  const busy = downs.length + ups.length + vault.count > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.visible || !busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [props.visible, busy]);

  const meta = track ? getForTrack(track) : null;

  // The picker waits for the sheet to finish sliding away: iOS will not
  // present it over a closing modal, and expo-document-picker then stays stuck
  // until the app is killed. See ui/afterDismiss.ts.
  const after = useAfterDismiss();
  const pick = (picker: () => Promise<import("@/upload/pickers").UploadDraft[]>) => {
    props.onClose();
    const { workspaceId, folderId } = target;
    after.queue(() => {
      startFromPicker({ picker, workspaceId, folderId })
        // A source that never opens is otherwise a row that does nothing.
        .catch(() => toast(t("common.error.couldnTOpenThePicker"), "error"));
    });
  };

  const showFolder = !!target.workspaceId && target.canCreateFolder;
  const [canScan] = useState(scannerAvailable);
  const showSources = target.canAdd || showFolder;

  // Where the folder goes is captured at press, so a target that changes while
  // the name prompt is open cannot move the folder somewhere else.
  const [creating, setCreating] = useState<{ workspaceId: string; parentId: string | null } | null>(null);
  const newFolder = () => {
    props.onClose();
    const { workspaceId, folderId } = target;
    if (!workspaceId) return;
    after.queue(() => setCreating({ workspaceId, parentId: folderId }));
  };

  return (
    <>
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose} onDismiss={after.onDismiss}>
      <Pressable testID="orbit-sheet-scrim" className="flex-1 justify-end bg-black/40" onPress={props.onClose}>
        {/* The card swallows presses so a tap inside it never closes the sheet. */}
        <Pressable testID="orbit-sheet" className="rounded-t-3xl bg-card" onPress={() => {}} style={{ paddingBottom: pad }}>
          <View className="items-center pb-1 pt-2.5">
            <View className="h-1 w-9 rounded-full bg-border" />
          </View>

          <ScrollView className="max-h-[520px]" showsVerticalScrollIndicator={false}>
            {busy ? (
              <View testID="orbit-sheet-transfers">
                <SectionLabel>{t("navigation.heading.countPluralOneTransferOtherTransfers", { count: downs.length + ups.length + vault.count })}</SectionLabel>
                {downs.map((e) => (
                  <DownloadRow key={e.fileId} entry={e} now={now} tint={tokens.mutedForeground} />
                ))}
                {ups.map((i) => (
                  <UploadRow key={i.id} item={i} tint={tokens.mutedForeground} destructive={tokens.destructive} />
                ))}
                {summary ? (
                  <VaultRow
                    summary={summary}
                    failed={vault.failed > 0}
                    tint={tokens.mutedForeground}
                    destructive={tokens.destructive}
                    onPress={() => { props.onClose(); router.push("/vault"); }}
                  />
                ) : null}
              </View>
            ) : null}

            {track ? (
              <View testID="orbit-sheet-now-playing" className={busy ? "mt-2 border-t border-border" : ""}>
                <SectionLabel>{t("navigation.heading.nowPlaying")}</SectionLabel>
                <View className="flex-row items-center gap-3 px-4 pb-2">
                  <Pressable
                    testID="orbit-open-player"
                    accessibilityRole="button"
                    accessibilityLabel={t("navigation.action.openPlayer")}
                    onPress={() => { props.onClose(); router.push("/player"); }}
                    className="min-w-0 flex-1 flex-row items-center gap-3"
                  >
                    {meta?.artworkUri ? (
                      <Image testID="orbit-sheet-artwork" source={{ uri: meta.artworkUri }} className="h-11 w-11 rounded-lg" />
                    ) : (
                      <View className="h-11 w-11 items-center justify-center rounded-lg bg-secondary">
                        <Icon name="musical-notes" size={19} color={tokens.mutedForeground} />
                      </View>
                    )}
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-bold text-foreground" numberOfLines={1}>
                        {meta?.title ?? track.title}
                      </Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {meta?.artist ?? track.artist}
                      </Text>
                    </View>
                  </Pressable>
                  <RoundButton label={playing ? t("common.accessibility.pause") : t("common.accessibility.play")} icon={playing ? "pause" : "play"} testID="orbit-toggle-play" onPress={() => void togglePlay()} color={tokens.foreground} />
                  {/* wrap: this is a deliberate Next press, so the last track comes
                      back round to the first rather than doing nothing (the
                      mini player this replaced carried the same contract). */}
                  <RoundButton label={t("common.accessibility.nextTrack")} icon="play-skip-forward" testID="orbit-next" onPress={() => void next({ wrap: true })} color={tokens.foreground} />
                  {/* Replaces the mini player's swipe-sideways-to-stop, which had
                      nowhere to go once the bar was removed. A gesture nobody
                      could discover becomes a labelled control. */}
                  <RoundButton label={t("navigation.action.stopPlayback")} icon="close" testID="orbit-stop" onPress={() => { props.onClose(); void stopAndClear(); }} color={tokens.mutedForeground} />
                </View>
              </View>
            ) : null}

            {showSources ? (
              <View testID="orbit-sheet-sources" className={busy || track ? "mt-2 border-t border-border" : ""}>
                <SectionLabel>{t("navigation.label.addToTargetLabel", { targetLabel: targetLabel(target) })}</SectionLabel>
                {showFolder ? (
                  <Source label={t("common.action.newFolder")} icon="folder-outline" testID="orbit-new-folder" onPress={newFolder} color={tokens.foreground} />
                ) : null}
                {target.canAdd ? (
                  <>
                <Source label={t("navigation.action.takePhoto")} icon="camera-outline" testID="orbit-source-camera" onPress={() => pick(capturePhoto)} color={tokens.foreground} />
                {/* Hidden, not disabled, on a phone with no scanner (Android
                    without Google Play services): there is nothing to explain. */}
                {canScan ? (
                  <Source label={t("navigation.action.scanDocument")} icon="scan-outline" testID="orbit-source-scan" onPress={() => pick(scanDocument)} color={tokens.foreground} />
                ) : null}
                <Source label={t("navigation.action.choosePhotos")} icon="images-outline" testID="orbit-source-photos" onPress={() => pick(pickPhotos)} color={tokens.foreground} />
                <Source label={t("navigation.action.chooseFiles")} icon="document-outline" testID="orbit-source-files" onPress={() => pick(pickDocuments)} color={tokens.foreground} />
                  </>
                ) : null}
              </View>
            ) : null}

            {/* A viewer with nothing moving and nothing playing would otherwise
                open an empty card and be told nothing at all. */}
            {!busy && !track && !showSources ? (
              <View testID="orbit-sheet-empty" className="px-4 pb-6 pt-2">
                <Text className="text-[15px] text-foreground">{t("navigation.label.nothingToAddHere")}</Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  {t("navigation.description.youHaveReadOnlyAccessToThisWorkspace")}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
    {creating ? <NewFolderPrompt workspaceId={creating.workspaceId} parentId={creating.parentId} onClose={() => setCreating(null)} /> : null}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="px-4 pb-1.5 pt-3 text-[10.5px] uppercase text-muted-foreground"
      style={{ fontFamily: fonts.mono, letterSpacing: 1.1 }}
    >
      {children}
    </Text>
  );
}

function DownloadRow({ entry, now, tint }: { entry: DownloadEntry; now: number; tint: string }) {
  const t = useT();
  return (
    <TransferRow
      icon="arrow-down"
      name={entry.name}
      caption={progressCaption(entry, now)}
      tint={tint}
      action={{ label: t("common.cancel"), testID: `orbit-cancel-${entry.fileId}`, a11y: t("navigation.label.cancelName", { name: entry.name }), onPress: () => void cancelDownload(entry.fileId) }}
    />
  );
}

function UploadRow({ item, tint, destructive }: { item: UploadItem; tint: string; destructive: string }) {
  const t = useT();
  const failed = item.status === "error";
  return (
    <TransferRow
      icon={failed ? "alert-circle" : "arrow-up"}
      iconColor={failed ? destructive : undefined}
      name={item.name}
      caption={uploadCaption(item)}
      captionColor={failed ? destructive : undefined}
      tint={tint}
      // Uploads have no cancel primitive anywhere in the app - the dock never
      // offered one either - so this row deliberately does not invent one.
      action={failed ? { label: t("common.retry"), testID: `orbit-retry-${item.id}`, a11y: t("navigation.label.retryName", { name: item.name }), onPress: () => retryItem(item.id) } : null}
    />
  );
}

/**
 * The Vault's row: one line for the whole Vault, and a door into it.
 *
 * It is pressable where the other transfer rows are not, because it is the
 * only row that cannot say what it is working on - the answer is one tap away
 * instead, inside the lock.
 */
function VaultRow(props: {
  summary: { title: string; caption: string };
  failed: boolean;
  tint: string;
  destructive: string;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <Pressable
      testID="orbit-vault-summary"
      accessibilityRole="button"
      accessibilityLabel={`${props.summary.title}, ${props.summary.caption}`}
      accessibilityHint={t("navigation.description.opensYourVault")}
      onPress={props.onPress}
      className="flex-row items-center gap-3 px-4 py-2"
    >
      <Icon name={props.failed ? "alert-circle" : "lock-closed"} size={17} color={props.failed ? props.destructive : props.tint} />
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] text-foreground" numberOfLines={1}>{props.summary.title}</Text>
        <Text
          className="text-[10.5px] text-muted-foreground"
          numberOfLines={1}
          style={{ fontFamily: fonts.mono, color: props.failed ? props.destructive : undefined }}
        >
          {props.summary.caption}
        </Text>
      </View>
      <Icon name="chevron-forward" size={16} color={props.tint} />
    </Pressable>
  );
}

function TransferRow(props: {
  icon: IconName;
  iconColor?: string;
  name: string;
  caption: string;
  captionColor?: string;
  tint: string;
  action: { label: string; testID: string; a11y: string; onPress: () => void } | null;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 py-2">
      <Icon name={props.icon} size={17} color={props.iconColor ?? props.tint} />
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] text-foreground" numberOfLines={1}>{props.name}</Text>
        <Text
          className="text-[10.5px] text-muted-foreground"
          numberOfLines={1}
          style={{ fontFamily: fonts.mono, color: props.captionColor }}
        >
          {props.caption}
        </Text>
      </View>
      {props.action ? (
        <Pressable
          testID={props.action.testID}
          accessibilityRole="button"
          accessibilityLabel={props.action.a11y}
          onPress={props.action.onPress}
          hitSlop={8}
          className="rounded-full bg-secondary px-3 py-1.5"
        >
          <Text className="text-xs font-medium text-secondary-foreground">{props.action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Source(props: { label: string; icon: IconName; testID: string; onPress: () => void; color: string }) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className="flex-row items-center gap-3 px-4 py-3.5"
    >
      <Icon name={props.icon} size={21} color={props.color} />
      <Text className="text-base text-foreground">{props.label}</Text>
    </Pressable>
  );
}

function RoundButton(props: { label: string; icon: IconName; testID: string; onPress: () => void; color: string }) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={6}
      className="h-9 w-9 items-center justify-center rounded-full bg-secondary"
    >
      <Icon name={props.icon} size={16} color={props.color} />
    </Pressable>
  );
}

function uploadCaption(i: UploadItem): string {
  if (i.status === "error") return itemErrorText(i, translate) ?? translate("common.error.uploadFailed");
  if (i.status === "queued") return translate("navigation.label.waitingToUpload");
  return translate("navigation.label.uploadingPercent", { percent: localDigits(Math.min(99, Math.round((i.progress || 0) * 100))) });
}
