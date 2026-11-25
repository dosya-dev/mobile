import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useT } from "@/lib/i18n";
import type { StagePalette } from "../stageTheme";
import { localDigits } from "@/lib/format-locale";

/**
 * A photo, fit whole into the stage.
 *
 * `contain`, never `cover`: the viewer's job is to show the file, and cropping
 * a portrait photo to a landscape stage hides part of what the user opened.
 *
 * The natural size is reported upward as it loads, which is where the meta
 * line's "4032 x 3024" comes from - the API returns no dimensions, and the
 * native loader knows them anyway.
 */
export function ImageStage(props: {
  uri: string;
  headers?: Record<string, string>;
  /** A smaller already-cached derivative to show while the full one decodes. */
  placeholder?: { uri: string; headers?: Record<string, string> } | null;
  /** "memory" for a restricted file, whose bytes must not reach the disk. */
  cachePolicy?: "memory-disk" | "memory";
  palette: StagePalette;
  onDimensions?: (label: string) => void;
  onFailed?: () => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState(true);

  return (
    <View className="flex-1 items-center justify-center">
      <ExpoImage
        testID="image-stage"
        source={{ uri: props.uri, headers: props.headers }}
        placeholder={props.placeholder ?? undefined}
        placeholderContentFit="contain"
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
        transition={140}
        // memory-disk, not disk: a swipe back to the previous photo should not
        // re-read and re-decode bytes that are still in memory. A restricted
        // file drops to memory-only - see files/cachePolicy.ts.
        cachePolicy={props.cachePolicy ?? "memory-disk"}
        recyclingKey={props.uri}
        onLoad={(e: { source?: { width?: number; height?: number } | null }) => {
          setLoading(false);
          const w = e?.source?.width;
          const h = e?.source?.height;
          if (w && h) props.onDimensions?.(t("common.label.wXH", { w: localDigits(w), h: localDigits(h) }));
        }}
        onError={() => {
          setLoading(false);
          props.onFailed?.();
        }}
      />
      {loading ? (
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          <ActivityIndicator color={props.palette.fgMuted} />
        </View>
      ) : null}
    </View>
  );
}
