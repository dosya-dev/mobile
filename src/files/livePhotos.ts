/**
 * Ported from apps/web/src/lib/live-photos.ts - keep in sync
 *
 * Live Photo pairing on the client. The API decides what is a pair (see
 * apps/api/src/lib/repo/repo-d1/live-pairs.ts); these helpers only read its answer.
 * Grids collapse the twin under the still; list view keeps it as a row right
 * under the still.
 */
export interface LivePairFields {
  id: string;
  live_video_id?: string | null;
  live_photo_id?: string | null;
}

export function isLiveStill(f: LivePairFields): boolean {
  return typeof f.live_video_id === "string" && f.live_video_id.length > 0;
}

export function isLiveTwin(f: LivePairFields): boolean {
  return typeof f.live_photo_id === "string" && f.live_photo_id.length > 0;
}

/** Grid order: every twin whose still is in the list disappears. */
export function collapseLiveTwins<T extends LivePairFields>(files: readonly T[]): T[] {
  const stills = new Set(files.filter(isLiveStill).map((f) => f.id));
  return files.filter((f) => !(isLiveTwin(f) && stills.has(f.live_photo_id!)));
}

/** List order: each twin sits directly after its still; orphan twins keep their place. */
export function twinsUnderStills<T extends LivePairFields>(files: readonly T[]): T[] {
  const twinsByStill = new Map<string, T>();
  for (const f of files) if (isLiveTwin(f)) twinsByStill.set(f.live_photo_id!, f);
  const stills = new Set(files.filter(isLiveStill).map((f) => f.id));
  const out: T[] = [];
  for (const f of files) {
    if (isLiveTwin(f) && stills.has(f.live_photo_id!)) continue;
    out.push(f);
    if (isLiveStill(f)) {
      const twin = twinsByStill.get(f.id);
      if (twin) out.push(twin);
    }
  }
  return out;
}

export function liveTwinOf<T extends LivePairFields>(files: readonly T[], still: LivePairFields): T | null {
  if (!isLiveStill(still)) return null;
  return files.find((f) => f.id === still.live_video_id) ?? null;
}
