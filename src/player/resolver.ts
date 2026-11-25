import { getDownloadUrl } from "@/files/api";
import { getCachedUri } from "./cache";
import type { PlayerTrack } from "./types";

export const AUDIO_URL_TTL_SECONDS = 3600;

/**
 * Cached file first (zero network), else a presigned URL with the audio ttl.
 * Locked files never reach here - the queue builder excludes them.
 */
export async function resolveTrackUrl(t: PlayerTrack): Promise<{ url: string; fromCache: boolean }> {
  const cached = await getCachedUri(t);
  if (cached) return { url: cached, fromCache: true };
  const url = await getDownloadUrl(t.fileId, undefined, AUDIO_URL_TTL_SECONDS);
  return { url, fromCache: false };
}
