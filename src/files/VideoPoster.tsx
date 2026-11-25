import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image as ExpoImage } from "expo-image";
import { getAccessToken } from "@/auth/authStore";
import { imageCachePolicy } from "./cachePolicy";
import { fileThumbUrl } from "./fileUrl";
import { cachedPoster, dropCachedPoster, ensurePoster } from "./posterCache";
import type { FileItem } from "./types";

type Stage = { kind: "local"; uri: string } | { kind: "server" } | { kind: "grabbing" } | { kind: "none" };

function initialStage(file: FileItem): Stage {
  if (file.lock_mode === "full_lock") return { kind: "none" };
  const local = cachedPoster(file);
  return local ? { kind: "local", uri: local } : { kind: "server" };
}

/**
 * A video's still frame, filling its parent. Renders `fallback` (the play
 * glyph or file icon the caller already draws) until there is a picture, and
 * for good when none can be had.
 *
 * Walks the order in posterCache.ts: this device's copy, the server's poster,
 * then a frame grabbed here. A fully locked video never gets a picture - its
 * card shows a lock, and a poster would be the one legible thing about it.
 */
export function VideoPoster({ file, fallback }: { file: FileItem; fallback?: ReactNode }) {
  const [stage, setStage] = useState<Stage>(() => initialStage(file));
  // One fresh grab per mount: a frame this device made that still will not
  // render is not going to render on the next try either.
  const regrabbed = useRef(false);

  // A recycled card points this component at a different video.
  useEffect(() => {
    regrabbed.current = false;
    setStage(initialStage(file));
  }, [file.id, file.current_version, file.lock_mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage.kind !== "grabbing") return;
    let alive = true;
    ensurePoster(file).then((uri) => {
      if (alive) setStage(uri ? { kind: "local", uri } : { kind: "none" });
    });
    return () => { alive = false; };
  }, [stage.kind, file]);

  if (stage.kind === "none" || stage.kind === "grabbing") return <>{fallback ?? null}</>;

  const token = getAccessToken();
  const source = stage.kind === "local"
    ? { uri: stage.uri }
    : {
        uri: fileThumbUrl(file.id, 512, file.current_version),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      };

  return (
    <>
      {fallback ?? null}
      <ExpoImage
        testID={`video-poster-${file.id}`}
        source={source}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        contentFit="cover"
        transition={120}
        cachePolicy={imageCachePolicy(file)}
        recyclingKey={source.uri}
        onError={(e) => {
          // Scrolling away cancels a load; that is not "no poster" (see FileThumb).
          if (/cancel/i.test(e?.error ?? "")) return;
          // The server has none yet (404 no-poster), or the local copy went
          // missing: make one here.
          if (stage.kind === "local") {
            dropCachedPoster(file);
            if (regrabbed.current) return setStage({ kind: "none" });
            regrabbed.current = true;
          }
          setStage((s) => (s.kind === "server" || s.kind === "local" ? { kind: "grabbing" } : s));
        }}
      />
    </>
  );
}
