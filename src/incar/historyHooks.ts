import TrackPlayer, { Event, State } from "react-native-track-player";
import { usePlayerStore } from "@/player/playerStore";
import { setCurrentPlayback, updatePlaybackPosition, pushRecent } from "./recents";

// TODO(android-auto follow-up spec): folder id isn't on PlayerTrack today
// (see @/player/types.ts) — resolve the real folderId at the call site once
// that's threaded through, rather than hardcoding null here.
import { useWorkspaceStore } from "@/files/workspaceStore";

/**
 * Separate from the core playback service (src/player/service.ts) on purpose:
 * this is CarPlay/incar-specific persistence, not core playback behavior, and
 * keeping it in its own listener set means it can be dropped or reused for
 * Android Auto without touching the player's own event handling.
 */
export function installHistoryHooks(): void {
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
    if (typeof e.index !== "number") return;
    const { queue, sourceName } = usePlayerStore.getState();
    const track = queue[e.index];
    if (!track) return;
    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!workspaceId) return;
    const now = Date.now();
    const entry = {
      workspaceId,
      folderId: null,
      fileId: track.fileId,
      title: track.title,
      sourceName: sourceName ?? track.artist,
    };
    void setCurrentPlayback({ ...entry, positionSeconds: 0, durationSeconds: null }, now);
    void pushRecent(entry, now);
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => {
    const { queue, index } = usePlayerStore.getState();
    const track = queue[index];
    if (!track) return;
    void updatePlaybackPosition(track.fileId, e.position, Date.now());
  });

  // Progress events are coarse (see ensureSetup), so a pause saves the exact spot.
  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    if (e.state !== State.Paused) return;
    const { queue, index } = usePlayerStore.getState();
    const track = queue[index];
    if (!track) return;
    void TrackPlayer.getProgress()
      .then(({ position }) => updatePlaybackPosition(track.fileId, position, Date.now()))
      .catch(() => {});
  });
}
