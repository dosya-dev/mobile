import TrackPlayer, { Event, State } from "react-native-track-player";
import { ensureI18n, t } from "@/lib/i18n";
import { toast } from "@/ui/toast";
import { usePlayerStore } from "./playerStore";
import { next, previous, resolveWindow, toRntpTrack } from "./controller";
import { installMetadataTriggers, onPlaybackStarted, resetNowPlayingPush } from "./metadata/triggers";
import { resolveTrackUrl } from "./resolver";

/** One retry per track per stay - reset whenever the active track changes. */
const retried = new Set<string>();

/**
 * Fires PlaybackActiveTrackChanged for the SAME track when a retry's own
 * TrackPlayer.load() lands (this is expected RNTP behavior on Android). Only
 * clear the retry bookkeeping when the active file actually changed, so a
 * persistently unplayable track can't refill its one retry on its own echo
 * and loop presign -> load -> error forever instead of skipping.
 */
let lastActiveFileId: string | null = null;

/**
 * RNTP headless playback service. Runs (and keeps running in the background)
 * for as long as the audio session is alive - all lock-screen/notification
 * events and mid-playback errors land here, never in React components.
 */
export async function playbackService(): Promise<void> {
  // Headless: nothing has booted the language, and the lock-screen text is built here.
  await ensureI18n();
  // Real usage calls this exactly once per app session (registered by index.js),
  // so this is a no-op there; it exists so re-invoking the service (as tests do
  // between cases) starts with clean retry bookkeeping instead of leaking state
  // across unrelated sessions/tracks.
  retried.clear();
  lastActiveFileId = null;
  installMetadataTriggers();

  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    // A press on the notification/lock-screen Next: same contract as the
    // in-app button, so the last track wraps rather than doing nothing.
    void next({ wrap: true }).catch(() => usePlayerStore.getState().setPlaying(false));
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void previous().catch(() => usePlayerStore.getState().setPlaying(false));
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => {
    void TrackPlayer.seekTo(e.position);
  });

  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    const playing = e.state === State.Playing || e.state === State.Buffering;
    usePlayerStore.getState().setPlaying(playing);
    if (e.state !== State.Loading && e.state !== State.Ready) usePlayerStore.getState().setListening(playing);
    if (e.state === State.Playing) void onPlaybackStarted().catch(() => {});
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
    if (typeof e.index !== "number") return;
    const fileId = usePlayerStore.getState().queue[e.index]?.fileId ?? null;
    if (fileId !== lastActiveFileId) {
      retried.clear();
      resetNowPlayingPush();
      lastActiveFileId = fileId;
    }
    usePlayerStore.getState().setIndex(e.index);
    void resolveWindow(e.index).catch(() => {});
    // Auto-advance (e.g. Android/ExoPlayer sliding into a preloaded next
    // item) stays in STATE_READY/Playing without a PlaybackState transition,
    // so no Event.PlaybackState fires here - onPlaybackStarted must be
    // triggered from this event too, or the lock screen keeps showing the
    // PREVIOUS track's tags and parser-less durations never get captured
    // during continuous listening. Idempotent: gated by pushedForFileId and
    // the parsedAt check inside onPlaybackStarted itself.
    if (usePlayerStore.getState().playing) void onPlaybackStarted().catch(() => {});
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async () => {
    const { queue, index } = usePlayerStore.getState();
    const track = queue[index];
    if (!track) return;
    if (!retried.has(track.fileId)) {
      retried.add(track.fileId);
      try {
        // Expired presign is the expected cause (long tracks, backgrounded
        // sessions): re-resolve, reload in place, resume where it died.
        const { position } = await TrackPlayer.getProgress();
        const r = await resolveTrackUrl(track);
        await TrackPlayer.load(toRntpTrack(track, r.url));
        resetNowPlayingPush();
        if (position > 0) await TrackPlayer.seekTo(position);
        await TrackPlayer.play();
        return;
      } catch {
        // fall through - offline or the file is gone; skip instead of looping
      }
    }
    toast(t("audio.error.couldnTPlayTitleSkipping", { title: track.title }), "error");
    void next().catch(() => usePlayerStore.getState().setPlaying(false));
  });
}
