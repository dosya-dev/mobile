import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { stagePalette } from "../stageTheme";
import { BUFFER_TIMEOUT_MS } from "../videoSupport";
import { vlcVideoView, type VlcViewRef } from "../vlcPlayer";
import { StageMessage } from "./StageMessage";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * The libVLC stage - where MKV, AVI and the rest of the AVPlayer denylist go
 * on iOS instead of the "save and open in VLC" card.
 *
 * libVLC draws into a bare surface with no controls of its own, so the three
 * things a viewer actually needs - play/pause, seek, elapsed time - are built
 * here, on the same tap-to-seek pattern as app/player.tsx and in the stage
 * palette rather than the app theme (the stage is always dark).
 *
 * The stall message renders OVER the player instead of replacing it. A slow
 * MKV open at second fourteen must not be aborted at second fifteen by its
 * own progress indicator - when the first frame finally arrives, onLoaded
 * dismisses the overlay by itself.
 */
export function VlcVideoStage(props: {
  uri: string | null;
  onDuration?: (seconds: number) => void;
  onSave?: () => void;
  onRetry?: () => void;
}) {
  const t = useT();
  const palette = stagePalette("dark");
  const insets = useSafeAreaInsets();
  const ref = useRef<VlcViewRef>(null);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  // A new uri is a new stream: retry re-presigns, and stale state from the
  // previous attempt (a failure card, an old position) must not outlive it.
  useEffect(() => {
    setPaused(false);
    setDuration(0);
    setTime(0);
    setLoaded(false);
    setFailed(false);
    setEnded(false);
  }, [props.uri]);

  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!props.uri || loaded || failed) return;
    const t = setTimeout(() => setStalled(true), BUFFER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [props.uri, loaded, failed]);

  const NativeView = vlcVideoView();

  if (!NativeView) {
    // Unreachable when routed via VideoStage, which checks availability
    // first; kept so rendering this stage directly can never throw at mount.
    return <View testID="vlc-stage-unavailable" className="flex-1" style={{ backgroundColor: palette.bg }} />;
  }

  if (failed) {
    return (
      <StageMessage
        testID="vlc-failed"
        icon="film-outline"
        title={t("common.error.couldnTPlayThisVideo")}
        body={t("common.description.theStreamStoppedOrThisFileSCodecDefeatedTheBuiltInPlayerRetry")}
        actions={[
          ...(props.onRetry
            ? [{ testID: "vlc-failed-retry", icon: "refresh-outline" as const, label: t("common.retry"), onPress: props.onRetry }]
            : []),
          ...(props.onSave
            ? [{ testID: "vlc-failed-save", icon: "download-outline" as const, label: t("common.action.saveToDevice"), onPress: props.onSave }]
            : []),
        ]}
      />
    );
  }

  const seekable = loaded && duration > 0;
  const pct = seekable ? Math.min(1, time / duration) : 0;

  return (
    <View className="flex-1" style={{ backgroundColor: palette.bg }}>
      <NativeView
        ref={ref}
        uri={props.uri}
        paused={paused}
        style={{ flex: 1 }}
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
          // Some containers only reveal length after playback starts.
          if (!duration && e.nativeEvent.duration > 0) setDuration(e.nativeEvent.duration);
        }}
        onEnd={() => {
          setEnded(true);
          setPaused(true);
          if (duration > 0) setTime(duration);
        }}
        onError={() => setFailed(true)}
      />

      {stalled && !loaded ? (
        <View
          testID="vlc-stalled"
          className="absolute inset-0"
          style={{ backgroundColor: palette.bg }}
        >
          <StageMessage
            testID="vlc-stalled-message"
            icon="hourglass-outline"
            title={t("common.heading.stillLoading")}
            body={t("common.description.fifteenSecondsWithoutAFirstFrameEitherTheConnectionIsPoorOrThisFile")}
            actions={[
              ...(props.onRetry
                ? [{ testID: "vlc-stalled-retry", icon: "refresh-outline" as const, label: t("common.retry"), onPress: props.onRetry }]
                : []),
              ...(props.onSave
                ? [{ testID: "vlc-stalled-save", icon: "download-outline" as const, label: t("common.action.saveToDevice"), onPress: props.onSave }]
                : []),
            ]}
          />
        </View>
      ) : null}

      {/* The stage fills the screen: the viewer wraps it in a plain flex View
          with no SafeAreaView, and the sheet that usually sits over this bar is
          slid away in immersive mode - so these controls have to carry the
          bottom inset themselves, or play/pause and the scrub bar end up behind
          an Android three-button navigation bar. */}
      {loaded ? (
        <View testID="vlc-controls" className="absolute inset-x-0 px-4" style={{ bottom: insets.bottom + 16 }}>
          <View
            className="flex-row items-center gap-3 rounded-2xl px-3.5 py-2.5"
            style={{ backgroundColor: "rgba(2,8,14,0.72)", direction: "ltr" }}
          >
            <Pressable
              testID="vlc-play-pause"
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
              style={{ backgroundColor: palette.chrome }}
            >
              <Icon name={ended ? "refresh" : paused ? "play" : "pause"} size={18} color={palette.fg} />
            </Pressable>

            <Text className="w-11 text-right text-[11px] tabular-nums" style={{ color: palette.fgMuted }}>
              {fmt(time)}
            </Text>

            <Pressable
              testID="vlc-seek-bar"
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
              <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: palette.chrome }}>
                <View className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: palette.fg }} />
              </View>
            </Pressable>

            <Text className="w-11 text-[11px] tabular-nums" style={{ color: palette.fgMuted }}>
              {seekable ? `-${fmt(Math.max(0, duration - time))}` : "--:--"}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
