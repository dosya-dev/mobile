import { Platform } from "react-native";
import TrackPlayer, { AppKilledPlaybackBehavior, Capability, RepeatMode, State } from "react-native-track-player";
import { toast } from "@/ui/toast";
import { t } from "@/lib/i18n";
import { usePlayerStore } from "./playerStore";
import { buildTracks, fetchAllAudioTracks, QUEUE_CAP, type FetchQueueParams } from "./queue";
import { resolveTrackUrl } from "./resolver";
import { cacheTrack, cancelCachingExcept, getCachedUri, markPlayed } from "./cache";
import { extractMetadataFromUrl } from "./metadata/extract";
import { getForTrack, isStaleParse } from "./metadata/metadataStore";
import type { PlayerTrack } from "./types";
import type { FileItem } from "@/files/types";
import { localDigits } from "@/lib/format-locale";

/**
 * Queue entries beyond the play window carry this URL. Presigned URLs expire in
 * minutes, so presigning a whole queue upfront would hand the native player a
 * list of dead links - instead the active track and its successor are resolved
 * just-in-time (resolveWindow) and anything else on demand (jumpTo).
 */
export const PLACEHOLDER_URL = "https://unresolved.invalid/track";

/**
 * Too close to the end of a track to touch the queue: the swap is a remove then
 * an add, and a track finishing in between would find no next track and stop.
 */
const SWAP_MARGIN_SECONDS = 10;

/**
 * Seconds. ExoPlayer's default is 50 and 50, so it tops up a sliver at a time
 * and the radio never rests; a gap makes it fill once and go quiet. Android
 * only: on iOS minBuffer overrides the system's own choice.
 */
const ANDROID_STREAM_BUFFER = { minBuffer: 20, maxBuffer: 75 };

let setupDone = false;

/**
 * All native queue mutations (getQueue -> resolve -> remove -> add) must run
 * one at a time: RNTP gives no atomicity across that read-modify-write, and
 * these fire concurrently in practice (service events racing user taps).
 * Chaining every mutating op through this mutex stops interleavings from
 * corrupting the queue (e.g. two concurrent remove([i]) calls deleting the
 * wrong track because the second one's index was computed before the first
 * one's remove landed). A failed op still lets the queue drain: `run` (what
 * callers await) carries the real rejection, but `queueOp` itself is always
 * swallowed to a resolved promise so one failure can't jam every op after it.
 */
let queueOp: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueOp.then(fn, fn);
  queueOp = run.catch(() => {});
  return run;
}

export async function ensureSetup(): Promise<void> {
  if (setupDone) return;
  await TrackPlayer.setupPlayer({ autoHandleInterruptions: true, ...(Platform.OS === "android" ? ANDROID_STREAM_BUFFER : {}) });
  await TrackPlayer.updateOptions({
    android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
    capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
    // Battery: coarse native progress events; the fine-grained seek-bar polling
    // lives only in the player screen via useProgress while it is mounted.
    // The one listener saves a resume point; pausing saves it exactly.
    progressUpdateEventInterval: 30,
  });
  setupDone = true;
}

export function toRntpTrack(t: PlayerTrack, url: string): { id: string; url: string; title: string; artist: string } {
  return { id: t.fileId, url, title: t.title, artist: t.artist };
}

async function startQueueImpl(tracks: PlayerTrack[], startIndex: number, sourceName: string): Promise<void> {
  await ensureSetup();
  const resolved = await resolveTrackUrl(tracks[startIndex]);
  await TrackPlayer.reset();
  await TrackPlayer.add(tracks.map((t, i) => toRntpTrack(t, i === startIndex ? resolved.url : PLACEHOLDER_URL)));
  usePlayerStore.getState().setQueue(tracks, startIndex, sourceName);
  await TrackPlayer.skip(startIndex);
  await TrackPlayer.play();
}

function startQueue(tracks: PlayerTrack[], startIndex: number, sourceName: string): Promise<void> {
  return serialized(() => startQueueImpl(tracks, startIndex, sourceName));
}

export type PlayFolderParams = FetchQueueParams & { startFileId?: string };

/** Returns false when there is nothing to play (caller decides whether to navigate). */
export async function playFolder(p: PlayFolderParams): Promise<boolean> {
  const { tracks, truncated } = await fetchAllAudioTracks(p);
  if (tracks.length === 0) {
    toast(t("common.status.noAudioFilesHere"));
    return false;
  }
  if (truncated) toast(t("common.status.queueCappedAtQueueCapTracks", { queueCap: localDigits(QUEUE_CAP) }));
  const found = p.startFileId ? tracks.findIndex((t) => t.fileId === p.startFileId) : 0;
  await startQueue(tracks, Math.max(0, found), p.sourceName);
  return true;
}

/**
 * Queue an already-loaded list of files, starting at one of them.
 *
 * The viewer has the folder's files in hand (it pages through them), so it can
 * build the same queue the list's "Play all" would without refetching. Without
 * this, opening a track from the viewer could only ever play that one file -
 * tapping a song in a folder of fifty would end in silence after three minutes.
 *
 * Non-audio and locked entries are dropped by buildTracks, so a mixed folder
 * queues only what can actually play.
 */
export async function playFileQueue(
  files: FileItem[],
  startFileId: string,
  sourceName: string,
): Promise<boolean> {
  const tracks = buildTracks(files, sourceName);
  if (tracks.length === 0) {
    toast(t("common.error.thisFileCanTBePlayed"));
    return false;
  }
  const found = tracks.findIndex((t) => t.fileId === startFileId);
  await startQueue(tracks, Math.max(0, found), sourceName);
  return true;
}

export async function playSingleFile(file: FileItem, sourceName: string): Promise<boolean> {
  const tracks = buildTracks([file], sourceName);
  if (tracks.length === 0) {
    toast(t("common.error.thisFileCanTBePlayed"));
    return false;
  }
  await startQueue(tracks, 0, sourceName);
  return true;
}

/**
 * Point the next queue entry at its finished local copy, so the player reads
 * the file instead of streaming the same bytes a second time.
 */
async function swapInCachedCopyImpl(track: PlayerTrack): Promise<void> {
  const uri = await getCachedUri(track);
  if (!uri) return;
  const { queue, index } = usePlayerStore.getState();
  if (queue[index + 1]?.fileId !== track.fileId) return;
  if ((await TrackPlayer.getActiveTrackIndex()) !== index) return;
  const { position, duration } = await TrackPlayer.getProgress();
  if (duration > 0 && duration - position < SWAP_MARGIN_SECONDS) return;
  await TrackPlayer.remove([index + 1]);
  await TrackPlayer.add(toRntpTrack(track, uri), index + 1);
}

/** Download the next track, then have the player use that copy once it lands. */
function prefetchNext(track: PlayerTrack, url: string): void {
  void cacheTrack(track, url)
    .then(() => serialized(() => swapInCachedCopyImpl(track)))
    .catch(() => {});
}

/**
 * Tags of the track now streaming, read over small ranges. A full copy would be
 * the same data over the radio twice, so it is only the fallback for when a
 * range read fails.
 */
function readStreamingTags(track: PlayerTrack, url: string): void {
  void extractMetadataFromUrl(track, url).catch(() => cacheTrack(track, url));
}

/**
 * Invariant kept by the service on every track change: the active track and the
 * one after it always hold real URLs in the native queue. Also the battery play:
 * prefetch the next track so it plays from disk, and cancel fills that fell out
 * of the window.
 */
async function resolveWindowImpl(activeIndex: number): Promise<void> {
  const { queue } = usePlayerStore.getState();
  const active = queue[activeIndex];
  if (!active) return;
  const nextTrack = queue[activeIndex + 1];
  const tagsUnknown = isStaleParse(getForTrack(active));
  cancelCachingExcept(new Set(nextTrack ? [nextTrack.fileId] : []));
  void markPlayed(active.fileId);
  const nativeQueue = await TrackPlayer.getQueue();
  if (nativeQueue[activeIndex]?.url === PLACEHOLDER_URL) {
    // A wrap (e.g. repeat-all landing back on an earlier index) can leave the
    // native player parked on the active index while its URL is still a
    // placeholder - resolve and load it in place rather than silently
    // streaming a dead link, then resume playback.
    const r = await resolveTrackUrl(active);
    await TrackPlayer.load(toRntpTrack(active, r.url));
    await TrackPlayer.play();
    if (!r.fromCache && tagsUnknown) readStreamingTags(active, r.url);
  }
  const activeUrl = nativeQueue[activeIndex]?.url;
  if (tagsUnknown && typeof activeUrl === "string" && activeUrl.startsWith("http") && activeUrl !== PLACEHOLDER_URL) {
    readStreamingTags(active, activeUrl);
  }
  if (nextTrack && nativeQueue[activeIndex + 1]?.url === PLACEHOLDER_URL) {
    const r = await resolveTrackUrl(nextTrack);
    await TrackPlayer.remove([activeIndex + 1]);
    await TrackPlayer.add(toRntpTrack(nextTrack, r.url), activeIndex + 1);
    if (!r.fromCache) prefetchNext(nextTrack, r.url);
  }
}

export function resolveWindow(activeIndex: number): Promise<void> {
  return serialized(() => resolveWindowImpl(activeIndex));
}

export async function togglePlay(): Promise<void> {
  const { state } = await TrackPlayer.getPlaybackState();
  if (state === State.Playing || state === State.Buffering) await TrackPlayer.pause();
  else await TrackPlayer.play();
}

/** Pauses the queue if it is playing; never throws, even before setup. */
export async function pauseIfPlaying(): Promise<void> {
  try {
    const { state } = await TrackPlayer.getPlaybackState();
    if (state === State.Playing || state === State.Buffering) await TrackPlayer.pause();
  } catch {
    // Not set up yet: nothing is playing.
  }
}

async function jumpToImpl(index: number): Promise<void> {
  const { queue } = usePlayerStore.getState();
  const t = queue[index];
  if (!t) return;
  const nativeQueue = await TrackPlayer.getQueue();
  if (nativeQueue[index]?.url === PLACEHOLDER_URL) {
    const r = await resolveTrackUrl(t);
    await TrackPlayer.remove([index]);
    await TrackPlayer.add(toRntpTrack(t, r.url), index);
  }
  await TrackPlayer.skip(index);
  await TrackPlayer.play();
}

export function jumpTo(index: number): Promise<void> {
  return serialized(() => jumpToImpl(index));
}

/**
 * Advance one track.
 *
 * `wrap` is what a DELIBERATE Next press means - the transport controls here,
 * on the player screen and on the lock screen. Pressing Next on the last track
 * used to do nothing at all unless repeat-all happened to be on, which reads as
 * a dead button: the user asked for the next track and got silence. With `wrap`
 * the queue comes back round to the first track regardless of repeat mode.
 *
 * It stays OFF for the playback service's error-skip path. That caller reaches
 * `next()` because the current track would not play, and a queue where the last
 * track is unplayable would otherwise wrap and skip forever instead of stopping.
 *
 * Auto-advance is untouched either way: it is RNTP's own repeat mode that ends
 * playback after the last track, and "repeat off" must keep meaning that.
 */
export async function next({ wrap = false }: { wrap?: boolean } = {}): Promise<void> {
  const { queue, index, repeatMode } = usePlayerStore.getState();
  if (index >= queue.length - 1) {
    if (queue.length === 0) return;
    if (!wrap && repeatMode !== "queue") return;
    await jumpTo(0);
    return;
  }
  await jumpTo(index + 1);
}

export async function previous(): Promise<void> {
  const { position } = await TrackPlayer.getProgress();
  if (position > 3) {
    await TrackPlayer.seekTo(0);
    return;
  }
  const { index } = usePlayerStore.getState();
  if (index <= 0) {
    await TrackPlayer.seekTo(0);
    return;
  }
  await jumpTo(index - 1);
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Rebuild the native queue around the untouched, currently-playing entry:
 * remove every other index, then insert the new order before/after it.
 * Re-inserted entries revert to placeholders; resolveWindow re-resolves the one
 * that matters (next) right after.
 */
async function rebuildNativeQueueAround(newQueue: PlayerTrack[], newIndex: number): Promise<void> {
  const nq = await TrackPlayer.getQueue();
  const active = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  const others = nq.map((_, i) => i).filter((i) => i !== active);
  if (others.length) await TrackPlayer.remove(others);
  const before = newQueue.slice(0, newIndex).map((t) => toRntpTrack(t, PLACEHOLDER_URL));
  const after = newQueue.slice(newIndex + 1).map((t) => toRntpTrack(t, PLACEHOLDER_URL));
  if (before.length) await TrackPlayer.add(before, 0);
  if (after.length) await TrackPlayer.add(after);
}

export async function toggleShuffle(): Promise<void> {
  const s = usePlayerStore.getState();
  if (s.index < 0) return;
  const current = s.queue[s.index];
  let newQueue: PlayerTrack[];
  if (!s.shuffled) {
    newQueue = [...s.queue.slice(0, s.index + 1), ...shuffleArray(s.queue.slice(s.index + 1))];
    usePlayerStore.getState().setShuffled(true, s.queue);
  } else {
    newQueue = s.originalQueue ?? s.queue;
    usePlayerStore.getState().setShuffled(false, null);
  }
  const newIndex = Math.max(0, newQueue.findIndex((t) => t.fileId === current.fileId));
  // Rebuild, store update, and window repair run as ONE serialized block - calling
  // resolveWindowImpl directly (not the exported resolveWindow) so it doesn't
  // re-enter serialized() and deadlock waiting on this very op to finish.
  await serialized(async () => {
    await rebuildNativeQueueAround(newQueue, newIndex);
    usePlayerStore.getState().setQueueOrder(newQueue, newIndex);
    await resolveWindowImpl(newIndex);
  });
}

export async function cycleRepeat(): Promise<void> {
  const order = ["off", "queue", "track"] as const;
  const s = usePlayerStore.getState();
  const nextMode = order[(order.indexOf(s.repeatMode) + 1) % order.length];
  s.setRepeatMode(nextMode);
  await TrackPlayer.setRepeatMode(
    nextMode === "off" ? RepeatMode.Off : nextMode === "queue" ? RepeatMode.Queue : RepeatMode.Track,
  );
}

async function stopAndClearImpl(): Promise<void> {
  cancelCachingExcept(new Set());
  await TrackPlayer.reset();
  usePlayerStore.getState().clear();
}

export function stopAndClear(): Promise<void> {
  return serialized(stopAndClearImpl);
}
