import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { formatDuration } from "@/files/format";
import { stagePalette } from "../stageTheme";
import { vlcVideoView, type VlcViewRef } from "../vlcPlayer";

/**
 * The transport for audio this phone's own decoder refuses - OGG, Opus, WMA
 * on iOS (see audioSupport.ts). libVLC decodes them; the drawable stays a
 * hidden 1x1 point because there is nothing to draw.
 *
 * Unlike the video stage this does NOT autoplay: it sits under the artwork
 * exactly where InlineAudioPlayer's transport sits, and that one waits to be
 * tapped too. Consistency beats eagerness here - the user is looking at a
 * details screen, not a player they asked to start.
 *
 * Renders nothing when the build lacks the module - the caller treats that
 * case as "no transport", the same as any other file the queue cannot take.
 */
export function VlcInlineAudioPlayer(props: {
  uri: string;
  onDuration?: (seconds: number) => void;
}) {
  const t = useT();
  const palette = stagePalette("dark");
  const ref = useRef<VlcViewRef>(null);
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  const NativeView = vlcVideoView();
  if (!NativeView) return null;

  if (failed) {
    return (
      <Text testID="vlc-audio-failed" className="mt-6 text-center text-[12.5px]" style={{ color: palette.fgMuted }}>
        {t("files.error.couldnTPlayThisFileSaveItAndOpenItInAnotherApp")}
      </Text>
    );
  }

  const seekable = loaded && duration > 0;
  const pct = seekable ? Math.min(1, time / duration) : 0;

  return (
    <View testID="vlc-inline-audio" className="mt-6 w-full">
      <NativeView
        ref={ref}
        uri={props.uri}
        paused={paused}
        style={{ width: 1, height: 1, opacity: 0 }}
        onLoaded={(e) => {
          setLoaded(true);
          const d = e.nativeEvent.duration;
          if (d && Number.isFinite(d) && d > 0) {
            setDuration(d);
            props.onDuration?.(d);
          }
        }}
        onProgress={(e) => {
          setTime(e.nativeEvent.time);
          if (!duration && e.nativeEvent.duration > 0) setDuration(e.nativeEvent.duration);
        }}
        onEnd={() => {
          setEnded(true);
          setPaused(true);
          if (duration > 0) setTime(duration);
        }}
        onError={() => setFailed(true)}
      />
      <View
        className="flex-row items-center gap-3 rounded-2xl px-3.5 py-2.5"
        style={{ backgroundColor: palette.chrome, direction: "ltr" }}
      >
        <Pressable
          testID="vlc-audio-play-pause"
          accessibilityRole="button"
          accessibilityLabel={ended ? t("common.action.replay") : paused ? t("common.accessibility.play") : t("common.accessibility.pause")}
          onPress={() => {
            if (ended) {
              setEnded(false);
              setTime(0);
              void ref.current?.seekTo(0);
              setPaused(false);
            } else {
              setPaused((p) => !p);
            }
          }}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(255,255,255,0.16)" }}
        >
          <Icon name={ended ? "refresh" : paused ? "play" : "pause"} size={18} color={palette.fg} />
        </Pressable>

        <Text className="w-11 text-right text-[11px] tabular-nums" style={{ color: palette.fgMuted }}>
          {formatDuration(time)}
        </Text>

        <Pressable
          testID="vlc-audio-seek-bar"
          disabled={!seekable}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (!seekable || barWidth <= 0) return;
            // rtl-ok: media timeline (the controls sit in an ltr island, left is the start)
            const target = (e.nativeEvent.locationX / barWidth) * duration;
            setEnded(false);
            setTime(target);
            void ref.current?.seekTo(target);
          }}
          className="h-8 flex-1 justify-center"
        >
          <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.16)" }}>
            <View className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: palette.fg }} />
          </View>
        </Pressable>

        <Text className="w-11 text-[11px] tabular-nums" style={{ color: palette.fgMuted }}>
          {seekable ? `-${formatDuration(Math.max(0, duration - time))}` : "--:--"}
        </Text>
      </View>
    </View>
  );
}
