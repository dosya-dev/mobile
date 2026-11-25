import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Icon, type IconName } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { fileKind } from "./format";
import { imageCachePolicy } from "./cachePolicy";
import { thumbCandidates } from "./thumbSource";
import { ThumbSkeleton } from "./ThumbSkeleton";
import { VideoPoster } from "./VideoPoster";
import type { FileItem } from "./types";

const ICON: Record<ReturnType<typeof fileKind>, IconName> = {
  image: "image",
  video: "videocam",
  audio: "musical-notes",
  pdf: "document-text", office: "document-attach",
  text: "document",
  book: "book-outline",
  other: "document-outline",
};

/**
 * A file's visual: the real image thumbnail for image/HEIC files (cached on disk,
 * loaded with the mobile Bearer token), a poster frame for videos (VideoPoster),
 * and the file-type icon for everything else (or when a thumbnail fails to load).
 *
 * `variant="list"` renders a small 40pt square; `variant="grid"` fills a square tile.
 */
export function FileThumb({ file, variant, live }: { file: FileItem; variant: "list" | "grid" | "photo"; live?: boolean }) {
  const { tokens } = useColorTheme();
  const kind = fileKind(file.mime_type, file.extension);
  const isGrid = variant !== "list";

  // Ordered fallbacks, cheapest first - see thumbSource.ts. `attempt` walks
  // them; running off the end shows the file-type icon.
  // A photo tile is a grid tile without the rounding: the library packs tiles
  // edge to edge with 2pt gutters, the platform photo convention.
  const candidates = useMemo(
    () => (kind === "image" ? thumbCandidates(file, variant === "list" ? "list" : "grid") : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, variant, file.id, file.current_version, file.mime_type, file.extension],
  );
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // A recycled row points the same component at a different file; without this
  // it would inherit the previous file's exhausted attempt count and render an
  // icon for a picture that loads perfectly well.
  useEffect(() => { setAttempt(0); setLoaded(false); }, [file.id, file.current_version]);

  const source = candidates[attempt];
  const box =
    (variant === "photo" ? "aspect-square w-full" : isGrid ? "aspect-square w-full rounded-lg" : "h-10 w-10 rounded-md") +
    " overflow-hidden bg-muted items-center justify-center";

  if (source) {
    return (
      <View testID="file-thumb" className={box}>
        <ExpoImage
          testID={`thumb-img-${file.id}`}
          source={{ uri: source.uri, headers: source.headers }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={120}
          // A view-only or locked file renders but is never written to disk.
          cachePolicy={imageCachePolicy(file)}
          recyclingKey={source.uri}
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            const reason = e?.error ?? "unknown";
            // A cancelled request is not a broken URL. Scrolling past a row
            // tears its load down mid-flight, and Glide reports that the same
            // way it reports a real failure - so counting it against the
            // candidate list burns through the fallbacks and strands a
            // perfectly good picture on a file icon. Leave the attempt where
            // it is; the view re-requests when it comes back on screen.
            if (/cancel/i.test(reason)) return;
            if (__DEV__) {
              console.warn(`[FileThumb] ${file.id} attempt ${attempt} failed: ${source.uri} - ${reason}`);
            }
            setAttempt((n) => n + 1);
          }}
        />
        {loaded ? null : <ThumbSkeleton />}
        {live ? (
          <View testID="live-glyph" className="absolute bottom-1 start-1 h-4 w-4 items-center justify-center rounded-full bg-black/50">
            <View className="h-2.5 w-2.5 rounded-full border border-white" />
          </View>
        ) : null}
      </View>
    );
  }

  if (kind === "video") {
    // A still frame of the video (see posterCache.ts), over the glyph it
    // replaces once it loads. Grid tiles keep a small play mark on top so a
    // poster still reads as a video rather than a photo.
    const glyph = isGrid
      ? <Icon name="play-circle" size={44} color={tokens.mutedForeground} />
      : <Icon name={ICON.video} size={22} color={tokens.mutedForeground} />;
    return (
      <View testID="file-thumb" className={box}>
        <VideoPoster file={file} fallback={glyph} />
        {isGrid ? (
          <View testID="video-glyph" className="absolute bottom-1 start-1 rounded-full bg-black/50 p-0.5">
            <Icon name="play" size={12} color="#ffffff" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View testID="file-thumb" className={box}>
      <Icon name={ICON[kind]} size={isGrid ? 40 : 22} color={tokens.mutedForeground} />
    </View>
  );
}
