import { Image, Modal, Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { formatBytes, formatDate } from "@/files/format";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useMetadataStore } from "./metadata/metadataStore";
import { fmtDuration } from "./queueStats";
import type { PlayerTrack } from "./types";
import { localDigits } from "@/lib/format-locale";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between px-4 py-2.5">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text className="text-foreground text-sm flex-1 text-right" numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Bottom sheet with everything known about the current track - extracted on-device. */
export function InfoSheet({ track, visible, onClose }: { track: PlayerTrack | null; visible: boolean; onClose: () => void }) {
  const t = useT();
  const sheetPad = useSheetBottomPad();
  const entry = useMetadataStore((s) => (track ? s.entries[track.fileId] : undefined));
  const meta = entry && track && entry.sizeBytes === track.sizeBytes && entry.modifiedAt === track.modifiedAt ? entry : undefined;
  if (!track) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable testID="info-sheet-backdrop" className="flex-1 bg-black/40" onPress={onClose} />
      <View testID="info-sheet" className="rounded-t-2xl bg-card pt-4" style={{ paddingBottom: sheetPad }}>
        {meta?.artworkUri ? (
          <Image source={{ uri: meta.artworkUri }} className="self-center h-28 w-28 rounded-lg mb-2" resizeMode="cover" />
        ) : null}
        <Text className="px-4 py-1 text-base font-bold text-foreground" numberOfLines={2}>{meta?.title ?? track.title}</Text>
        {meta?.artist ? <Row label={t("audio.label.artist")} value={meta.artist} /> : null}
        {meta?.album ? <Row label={t("audio.label.album")} value={meta.album} /> : null}
        {meta?.durationSec ? <Row label={t("audio.label.duration")} value={fmtDuration(meta.durationSec)} /> : null}
        {meta?.bitrateKbps ? <Row label={t("audio.label.bitrate")} value={t("common.label.bitratekbpsKbps", { bitrateKbps: localDigits(Math.round(meta.bitrateKbps)) })} /> : null}
        {meta?.sampleRateHz ? <Row label={t("audio.label.sampleRate")} value={t("common.label.sampleratekhzKHz", { sampleRateKhz: (meta.sampleRateHz / 1000).toFixed(1) })} /> : null}
        <Row label={t("common.label.size")} value={formatBytes(track.sizeBytes)} />
        <Row label={t("files.label.type")} value={(track.extension ?? "audio").toUpperCase()} />
        <Row label={t("common.label.modified")} value={formatDate(track.modifiedAt)} />
      </View>
    </Modal>
  );
}
