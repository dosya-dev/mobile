import { View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

/**
 * Playback for an audio file that cannot use the real player.
 *
 * `buildTracks` filters `lock_mode !== "none"` out of the player queue, so a
 * locked file has no queue entry to hand off to even after it is unlocked.
 * Without this it would show its artwork and have no way to play - which is
 * worse than the screen this replaces, where the same file fell back to an
 * inline AV player.
 *
 * expo-video rather than a hand-built transport: it is already the app's AV
 * surface, and a locked file is rare enough not to justify a second one.
 */
export function InlineAudioPlayer(props: {
  uri: string;
  headers?: Record<string, string>;
  onDuration?: (seconds: number) => void;
}) {
  const player = useVideoPlayer(props.headers ? { uri: props.uri, headers: props.headers } : props.uri);

  return (
    <View testID="inline-audio-player" className="mt-6 w-full">
      <VideoView player={player} style={{ width: "100%", height: 56 }} nativeControls />
    </View>
  );
}
