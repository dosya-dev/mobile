// In-memory RNTP stand-in. Tests drive events with __emit and reset with __reset.
const listeners = {};

const TrackPlayer = {
  setupPlayer: jest.fn(async () => {}),
  updateOptions: jest.fn(async () => {}),
  registerPlaybackService: jest.fn(),
  addEventListener: jest.fn((event, cb) => {
    (listeners[event] ??= []).push(cb);
    return { remove: jest.fn() };
  }),
  reset: jest.fn(async () => {}),
  add: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
  load: jest.fn(async () => {}),
  skip: jest.fn(async () => {}),
  play: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
  seekTo: jest.fn(async () => {}),
  setRepeatMode: jest.fn(async () => {}),
  getQueue: jest.fn(async () => []),
  getActiveTrackIndex: jest.fn(async () => 0),
  getProgress: jest.fn(async () => ({ position: 0, duration: 0, buffered: 0 })),
  getPlaybackState: jest.fn(async () => ({ state: "none" })),
  updateMetadataForTrack: jest.fn(async () => {}),
};

module.exports = {
  __esModule: true,
  default: TrackPlayer,
  __emit: (event, payload) => (listeners[event] ?? []).forEach((cb) => cb(payload)),
  __reset: () => { for (const k of Object.keys(listeners)) delete listeners[k]; },
  Event: {
    RemotePlay: "remote-play",
    RemotePause: "remote-pause",
    RemoteNext: "remote-next",
    RemotePrevious: "remote-previous",
    RemoteSeek: "remote-seek",
    PlaybackState: "playback-state",
    PlaybackActiveTrackChanged: "playback-active-track-changed",
    PlaybackProgressUpdated: "playback-progress-updated",
    PlaybackError: "playback-error",
    PlaybackQueueEnded: "playback-queue-ended",
  },
  State: { None: "none", Ready: "ready", Playing: "playing", Paused: "paused", Stopped: "stopped", Buffering: "buffering", Loading: "loading" },
  RepeatMode: { Off: 0, Track: 1, Queue: 2 },
  Capability: { Play: 0, Pause: 1, SkipToNext: 2, SkipToPrevious: 3, SeekTo: 4 },
  AppKilledPlaybackBehavior: { StopPlaybackAndRemoveNotification: "stop-playback-and-remove-notification" },
  useProgress: jest.fn(() => ({ position: 0, duration: 0, buffered: 0 })),
  usePlaybackState: jest.fn(() => ({ state: "none" })),
  useActiveTrack: jest.fn(() => undefined),
};
