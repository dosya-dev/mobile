import TrackPlayer from "react-native-track-player";
import { getCachedUri, setOnTrackCached } from "../cache";
import { usePlayerStore } from "../playerStore";
import { extractMetadata } from "./extract";
import { getForTrack, isStaleParse, useMetadataStore } from "./metadataStore";

/**
 * Which fileId's tags/artwork have already been pushed to the lock screen for
 * the CURRENT activation of that track. The cache hook extracts eagerly
 * (often before the track is even active, via next-track prefetch), so by the
 * time a track starts playing its metadata usually already exists - the push
 * must not be conditioned on "did extraction just run", only on "have we
 * pushed for this activation yet". Cleared via resetNowPlayingPush() whenever
 * the active track genuinely changes or reloads, so the fresh load re-pushes.
 */
let pushedForFileId: string | null = null;

/** Wire extraction into the cache pipeline; called once from the playback service. */
export function installMetadataTriggers(): void {
  pushedForFileId = null;
  void useMetadataStore.getState().hydrate();
  setOnTrackCached((t, uri) => {
    // extractMetadata always records an entry (even a bare one for untagged
    // files), so having ATTEMPTED a parse (parsedAt) - not entry existence,
    // and not presence of a title - is the signal that this version has
    // already been processed. A bare entry can also come from the
    // duration-capture block in onPlaybackStarted (ensureEntry, no parse
    // attempted yet), and gating on existence alone would skip extraction
    // for that entry forever; gating on title would re-parse genuinely
    // untagged files on every download forever.
    //
    // isStaleParse, not a bare parsedAt check: entries written by the v1
    // extractor carry a parsedAt from a parse that matched no container and
    // produced nothing, so gating on parsedAt alone would keep every
    // already-played track tagless forever after the v2 fix.
    if (isStaleParse(getForTrack(t))) void extractMetadata(t, uri).catch(() => {});
  });
}

/** Force the next onPlaybackStarted to re-push Now Playing tags for the active track. */
export function resetNowPlayingPush(): void {
  pushedForFileId = null;
}

/**
 * Runs when playback enters Playing (once per activation, no polling):
 * capture the authoritative duration, extract a cached active track whose
 * parse is missing or stale (a bare duration-only entry counts as unparsed,
 * and so does one produced by an older extractor version - see isStaleParse),
 * and push tags/artwork to the lock screen - once
 * per activation (and again after resetNowPlayingPush() on track
 * change/reload), regardless of whether extraction ran just now or already
 * happened earlier.
 */
export async function onPlaybackStarted(): Promise<void> {
  const { queue, index } = usePlayerStore.getState();
  const track = queue[index];
  if (!track) return;
  const store = useMetadataStore.getState();
  let meta = getForTrack(track);
  if (isStaleParse(meta)) {
    const uri = await getCachedUri(track).catch(() => null);
    if (uri) meta = await extractMetadata(track, uri).catch(() => meta);
  }
  if ((meta?.title || meta?.artworkUri) && pushedForFileId !== track.fileId) {
    // Re-read immediately before the push: the awaits above may have let the
    // active track move on, and pushing tags for a track that is no longer
    // active would mislabel whatever plays next.
    const state = usePlayerStore.getState();
    const activeTrack = state.queue[state.index];
    if (activeTrack?.fileId === track.fileId) {
      await TrackPlayer.updateMetadataForTrack(state.index, {
        title: meta.title ?? track.title,
        artist: meta.artist ?? track.artist,
        ...(meta.artworkUri ? { artwork: meta.artworkUri } : {}),
      }).catch(() => {});
      pushedForFileId = track.fileId;
    }
  }
  if (!getForTrack(track)?.durationSec) {
    const { duration } = await TrackPlayer.getProgress();
    // Same re-check as the push above: the await may have let the active
    // track move on, and writing this duration under the old fileId would
    // mislabel a cached entry with the new track's duration.
    const state = usePlayerStore.getState();
    const activeTrack = state.queue[state.index];
    if (duration > 0 && activeTrack?.fileId === track.fileId) {
      store.ensureEntry(track);
      store.setDuration(track.fileId, duration);
    }
  }
}
