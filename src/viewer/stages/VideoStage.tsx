import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useT } from "@/lib/i18n";
import { BUFFER_TIMEOUT_MS, containerName, videoPlayable } from "../videoSupport";
import { isVlcAvailable } from "../vlcPlayer";
import { StageMessage } from "./StageMessage";
import { VlcVideoStage } from "./VlcVideoStage";

/**
 * The video stage.
 *
 * Two failure states exist here that did not before, both for the same reason:
 * a video that will not start renders as a black rectangle, and a black
 * rectangle is indistinguishable from a slow connection. That ambiguity is why
 * the underlying presign-expiry bug arrived as "big videos don't play" - three
 * different failures all looked the same on screen.
 *
 *  - A container this device has no decoder for is known BEFORE any bytes are
 *    fetched. When the build carries modules/dosya-vlc-player it goes to the
 *    libVLC stage, which has its own demuxers, and plays. Otherwise the stage
 *    says so immediately and offers the one thing that helps.
 *  - Anything else that has not produced a frame after fifteen seconds admits
 *    it does not know which of the two it is, and offers both ways out.
 *
 * The libVLC route requires a presigned uri, not a headers one: libVLC opens
 * the URL itself and has no supported way to attach an Authorization header,
 * so a view-only file (served from /raw with a Bearer token) keeps the card.
 */
export function VideoStage(props: {
  uri: string | null;
  headers?: Record<string, string>;
  mimeType: string;
  extension: string | null;
  onDuration?: (seconds: number) => void;
  /** True once the player has reported a duration - i.e. it really is working. */
  playing?: boolean;
  onSave?: () => void;
  onRetry?: () => void;
}) {
  const t = useT();
  const decodable = videoPlayable(props.mimeType, props.extension, Platform.OS);
  const source = props.uri
    ? props.headers
      ? { uri: props.uri, headers: props.headers }
      : props.uri
    : null;
  // Hooks must run unconditionally, so the player is created either way and
  // simply given nothing to open when the container is undecodable.
  const player = useVideoPlayer(decodable ? source : null);

  useEffect(() => {
    const onDuration = props.onDuration;
    if (!props.uri || !onDuration || !decodable) return;
    const p = player as unknown as {
      duration?: number;
      addListener?: (e: string, cb: () => void) => { remove: () => void };
    };
    const report = () => {
      const d = p?.duration;
      if (d && Number.isFinite(d) && d > 0) onDuration(d);
    };
    report();
    const sub = p?.addListener?.("statusChange", report);
    return () => sub?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.uri, player, decodable]);

  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!props.uri || !decodable || props.playing) return;
    const t = setTimeout(() => setStalled(true), BUFFER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [props.uri, decodable, props.playing]);

  if (!decodable) {
    if (!props.headers && isVlcAvailable()) {
      return (
        <VlcVideoStage
          uri={props.uri}
          onDuration={props.onDuration}
          onSave={props.onSave}
          onRetry={props.onRetry}
        />
      );
    }
    const format = containerName(props.mimeType, props.extension);
    const platform = Platform.OS === "ios" ? "ios" : "other";
    return (
      <StageMessage
        testID="video-unplayable"
        icon="film-outline"
        title={format ? t("common.heading.thisPhoneCanTPlayFormatVideo", { platform, format }) : t("common.heading.thisPhoneCanTPlayThisVideo", { platform })}
        body={t("common.description.iosHasNoDecoderForThisFormatSaveTheFileAndOpenItIn")}
        actions={
          props.onSave
            ? [{ testID: "video-unplayable-save", icon: "download-outline", label: t("common.action.saveToPhone"), onPress: props.onSave }]
            : []
        }
      />
    );
  }

  if (stalled) {
    return (
      <StageMessage
        testID="video-stalled"
        icon="hourglass-outline"
        title={t("common.heading.stillLoading")}
        body={t("common.description.fifteenSecondsWithoutAFirstFrameEitherTheConnectionIsPoorOrThisPhone")}
        actions={[
          ...(props.onRetry
            ? [{ testID: "video-stalled-retry", icon: "refresh-outline" as const, label: t("common.retry"), onPress: props.onRetry }]
            : []),
          ...(props.onSave
            ? [{ testID: "video-stalled-save", icon: "download-outline" as const, label: t("common.action.saveToDevice"), onPress: props.onSave }]
            : []),
        ]}
      />
    );
  }

  return (
    <View className="flex-1 items-center justify-center">
      <VideoView
        testID="video-stage"
        player={player}
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture
      />
    </View>
  );
}
