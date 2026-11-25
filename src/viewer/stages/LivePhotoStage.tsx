import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useT } from "@/lib/i18n";
import { ImageStage } from "./ImageStage";
import type { StagePalette } from "../stageTheme";

/**
 * A Live Photo: the still, and its twin video played over it while the user
 * presses and holds (400 ms, as in Photos). The badge is a plain tap target
 * for one play-through. The video view mounts only while playing, so an idle
 * page costs nothing more than an image page, and the still never waits on
 * the video.
 */
export function LivePhotoStage(props: {
  uri: string;
  headers?: Record<string, string>;
  placeholder?: { uri: string; headers?: Record<string, string> } | null;
  cachePolicy?: "memory-disk" | "memory";
  palette: StagePalette;
  onDimensions?: (label: string) => void;
  onFailed?: () => void;
  twinUri: string;
  twinHeaders?: Record<string, string>;
}) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer({ uri: props.twinUri, headers: props.twinHeaders }, (p) => {
    p.muted = true;
    p.loop = false;
  });

  // The player and its "playing" state belong to this twin only - a swipe to
  // a different Live Photo remounts the stage (keyed on live_video_id in the
  // route), but this still guards against a twinUri change without a remount.
  // Keyed on twinUri alone, not player: useVideoPlayer memoises the handle
  // per source, so the two move together anyway, and twinUri is the value
  // that actually names "which twin" - the reset should not depend on player
  // identity being included in the array to fire correctly.
  useEffect(() => {
    player.pause();
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.twinUri]);

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => setPlaying(false));
    return () => sub.remove();
  }, [player]);

  const play = () => { player.currentTime = 0; setPlaying(true); player.play(); };
  const stop = () => { player.pause(); setPlaying(false); };

  return (
    <Pressable testID="live-stage" className="flex-1" onLongPress={play} delayLongPress={400} onPressOut={stop}>
      <ImageStage {...props} />
      {playing ? (
        <View className="absolute inset-0" pointerEvents="none">
          <VideoView testID="live-video" player={player} style={{ width: "100%", height: "100%" }} contentFit="contain" nativeControls={false} />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.accessibility.playLivePhoto")}
        onPress={play}
        className={`absolute start-3 top-3 flex-row items-center gap-1 rounded-full px-2 py-1 ${playing ? "bg-brand" : "bg-black/50"}`}
      >
        <View className={`h-2.5 w-2.5 rounded-full border ${playing ? "border-brand-foreground" : "border-white"}`} />
        <Text className={`font-mono text-[9px] font-bold uppercase tracking-widest ${playing ? "text-brand-foreground" : "text-white"}`}>{t("files.label.live")}</Text>
      </Pressable>
    </Pressable>
  );
}
