import type { ReactNode } from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { baseName } from "@/files/format";
import type { StagePalette } from "../stageTheme";

/**
 * The audio hero: cover art if we have it, a music glyph if we do not.
 *
 * Artwork comes from the metadata store the player already fills while a track
 * plays. Nothing is parsed here on purpose - extraction reads up to 50MB off
 * disk, and doing that just because someone opened a file's details would turn
 * a tap into a long stall. A file you have played shows its art; one you have
 * not shows the glyph and gets its art the first time you play it.
 */
export function AudioStage(props: {
  name: string;
  artworkUri?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  palette: StagePalette;
  /** An inline transport, for a file the real player cannot queue. */
  footer?: ReactNode;
}) {
  const title = props.title || baseName(props.name);

  return (
    <View className="flex-1 items-center justify-center px-10">
      {props.artworkUri ? (
        <ExpoImage
          testID="audio-artwork"
          source={{ uri: props.artworkUri }}
          style={{ width: 238, height: 238, borderRadius: 20 }}
          contentFit="cover"
          transition={140}
          cachePolicy="disk"
        />
      ) : (
        <View
          testID="audio-artwork-fallback"
          className="h-[238px] w-[238px] items-center justify-center rounded-[20px]"
          style={{ backgroundColor: props.palette.chrome }}
        >
          <Icon name="musical-notes" size={72} color={props.palette.fgMuted} />
        </View>
      )}
      <Text className="mt-7 text-center text-lg font-bold" numberOfLines={2} style={{ color: props.palette.fg }}>
        {title}
      </Text>
      {props.artist ? (
        <Text className="mt-1 text-center text-sm" numberOfLines={1} style={{ color: props.palette.fgMuted }}>
          {props.artist}
        </Text>
      ) : null}
      {props.album ? (
        <Text className="mt-0.5 text-center text-xs" numberOfLines={1} style={{ color: props.palette.fgMuted }}>
          {props.album}
        </Text>
      ) : null}
      {props.footer}
    </View>
  );
}
