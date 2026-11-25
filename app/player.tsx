import { useState } from "react";
import { FlatList, Image, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { useT } from "@/lib/i18n";
import TrackPlayer, { useProgress } from "react-native-track-player";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { usePlayerStore } from "@/player/playerStore";
import { cycleRepeat, jumpTo, next, previous, togglePlay, toggleShuffle } from "@/player/controller";
import { AddToGroupSheet } from "@/groups/AddToGroupSheet";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useFavourite } from "@/player/useFavourite";
import { InfoSheet } from "@/player/InfoSheet";
import { getForTrack, useMetadataStore, type TrackMetadata } from "@/player/metadata/metadataStore";
import { fmtDuration, queueStats } from "@/player/queueStats";
import type { PlayerTrack } from "@/player/types";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Floating circular back control. The screen has no native header (see
 * app/_layout.tsx), so this is the only way back - rendered in both the
 * loaded and empty states.
 */
function BackButton({ onPress, color }: { onPress: () => void; color: string }) {
  const t = useT();
  return (
    <Pressable
      testID="player-back"
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      onPress={onPress}
      className="self-start h-10 w-10 items-center justify-center rounded-full bg-secondary"
    >
      <Icon name="chevron-back" size={22} color={color} />
    </Pressable>
  );
}

/**
 * Tap-to-seek progress bar. useProgress polls only while this screen is
 * mounted - the battery rule keeps fine-grained polling out of everything
 * that stays mounted (mini-player, service).
 */
function SeekBar() {
  const { position, duration } = useProgress(1000);
  const [width, setWidth] = useState(0);
  const pct = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <View className="mt-6" style={{ direction: "ltr" }}>
      <Pressable
        testID="seek-bar"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          // rtl-ok: media timeline (the bar sits in an ltr island, left is the start)
          if (duration > 0 && width > 0) void TrackPlayer.seekTo((e.nativeEvent.locationX / width) * duration);
        }}
        className="h-8 justify-center"
      >
        <View className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <View className="h-full bg-primary" style={{ width: `${pct * 100}%` }} />
        </View>
      </Pressable>
      <View className="flex-row justify-between">
        <Text className="text-muted-foreground text-xs">{fmt(position)}</Text>
        <Text className="text-muted-foreground text-xs">{duration > 0 ? `-${fmt(Math.max(0, duration - position))}` : "--:--"}</Text>
      </View>
    </View>
  );
}

export default function PlayerScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playing = usePlayerStore((s) => s.playing);
  const shuffled = usePlayerStore((s) => s.shuffled);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const track: PlayerTrack | null = queue[index] ?? null;

  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const [groupOpen, setGroupOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const { isFav, toggle, busy } = useFavourite(track?.fileId ?? null);
  const entries = useMetadataStore((s) => s.entries);
  const meta = track ? getForTrack(track) : null;
  const displayTitle = meta?.title ?? track?.title ?? "";
  const displayArtist = meta?.artist ?? track?.artist ?? "";
  const stats = queueStats(queue, entries);

  if (!track) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="px-6 pt-6">
          <BackButton onPress={() => router.back()} color={tokens.foreground} />
        </View>
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">{t("audio.description.nothingPlaying")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <View className="px-6 pt-6">
        <View className="mb-4">
          <BackButton onPress={() => router.back()} color={tokens.foreground} />
        </View>
        {meta?.artworkUri ? (
          <Image source={{ uri: meta.artworkUri }} className="self-center h-48 w-48 rounded-2xl" resizeMode="cover" />
        ) : (
          <View className="items-center justify-center self-center h-48 w-48 rounded-2xl bg-secondary">
            <Icon name="musical-notes" size={72} color={tokens.primary} />
          </View>
        )}
        <Text className="mt-6 text-xl font-bold text-foreground" numberOfLines={2}>{displayTitle}</Text>
        <Text className="mt-1 text-sm text-muted-foreground" numberOfLines={1}>{displayArtist}</Text>
        {meta?.album ? <Text className="text-xs text-muted-foreground" numberOfLines={1}>{meta.album}</Text> : null}
        <View className="mt-3 flex-row items-center gap-6">
          <Pressable testID="player-fav" accessibilityRole="button" accessibilityLabel={isFav ? t("audio.action.removeFavourite") : t("audio.action.addFavourite")} hitSlop={8} disabled={busy} onPress={toggle}>
            <Icon name={isFav ? "heart" : "heart-outline"} size={22} color={isFav ? tokens.primary : tokens.mutedForeground} />
          </Pressable>
          <Pressable testID="player-group" accessibilityRole="button" accessibilityLabel={t("common.action.addToGroup")} hitSlop={8} onPress={() => setGroupOpen(true)}>
            <Icon name="albums-outline" size={22} color={tokens.mutedForeground} />
          </Pressable>
          <Pressable testID="player-info" accessibilityRole="button" accessibilityLabel={t("audio.action.trackInfo")} hitSlop={8} onPress={() => setInfoOpen(true)}>
            <Icon name="information-circle-outline" size={22} color={tokens.mutedForeground} />
          </Pressable>
        </View>
        <SeekBar />
        <View className="mt-4 flex-row items-center justify-between" style={{ direction: "ltr" }}>
          <Pressable testID="player-shuffle" accessibilityRole="button" accessibilityLabel={t("audio.action.shuffle")} hitSlop={8} onPress={() => void toggleShuffle()}>
            <Icon name="shuffle" size={24} color={shuffled ? tokens.primary : tokens.mutedForeground} />
          </Pressable>
          <Pressable testID="player-previous" accessibilityRole="button" accessibilityLabel={t("audio.action.previousNextTrack")} hitSlop={8} onPress={() => void previous()}>
            <Icon name="play-skip-back" size={32} color={tokens.foreground} />
          </Pressable>
          <Pressable
            testID="player-toggle"
            accessibilityRole="button"
            accessibilityLabel={playing ? t("common.accessibility.pause") : t("common.accessibility.play")}
            onPress={() => void togglePlay()}
            className="h-16 w-16 items-center justify-center rounded-full bg-primary"
          >
            <Icon name={playing ? "pause" : "play"} size={32} color={tokens.primaryForeground} />
          </Pressable>
          <Pressable testID="player-next" accessibilityRole="button" accessibilityLabel={t("audio.action.nextTrack")} hitSlop={8} onPress={() => void next({ wrap: true })}>
            <Icon name="play-skip-forward" size={32} color={tokens.foreground} />
          </Pressable>
          <Pressable testID="player-repeat" accessibilityRole="button" accessibilityLabel={t("audio.action.repeatPlayback")} hitSlop={8} onPress={() => void cycleRepeat()} className="flex-row items-start">
            <Icon name="repeat" size={24} color={repeatMode === "off" ? tokens.mutedForeground : tokens.primary} />
            {repeatMode === "track" ? <Text className="text-primary text-xs">1</Text> : null}
          </Pressable>
        </View>
      </View>
      <FlatList
        className="mt-6 flex-1"
        data={queue}
        keyExtractor={(item) => item.fileId}
        ListHeaderComponent={
          <Text testID="queue-header" className="px-6 pb-1 text-xs text-muted-foreground">
            {t("audio.description.countPluralOneTrackOtherTracksHasDurationSelectTrueDurationOther", {
              count: stats.count,
              hasDuration: stats.totalLabel ? "true" : "false",
              duration: stats.totalLabel ?? "",
            })}
          </Text>
        }
        renderItem={({ item, index: i }) => {
          const meta: TrackMetadata | null = getForTrack(item);
          return (
            <Pressable
              testID={`queue-item-${item.fileId}`}
              accessibilityRole="button"
              onPress={() => void jumpTo(i)}
              className={"flex-row items-center gap-3 px-6 py-2.5 " + (i === index ? "bg-secondary" : "")}
            >
              <Text className="w-6 text-right text-xs text-muted-foreground">{i + 1}</Text>
              <Icon name={i === index ? "volume-medium" : "musical-note"} size={16} color={i === index ? tokens.primary : tokens.mutedForeground} />
              <Text className={(i === index ? "text-primary" : "text-foreground") + " text-sm flex-1"} numberOfLines={1}>
                {meta?.title || item.title}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {meta?.durationSec ? fmtDuration(meta.durationSec) : "--:--"}
              </Text>
            </Pressable>
          );
        }}
      />
      {track ? (
        <AddToGroupSheet target={groupOpen ? { kind: "file", id: track.fileId, name: track.title } : null} workspaceId={workspaceId} visible={groupOpen} onClose={() => setGroupOpen(false)} />
      ) : null}
      <InfoSheet track={track} visible={infoOpen} onClose={() => setInfoOpen(false)} />
    </SafeAreaView>
  );
}
