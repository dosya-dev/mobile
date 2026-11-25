// The line between the phone's reader port (./reader.ts) and the hidden
// WebView that runs the face reader (./ReaderHost.tsx). Kept free of the
// engine and of React so the root layout can mount ReaderHost without loading
// either.
//
// - The WebView is mounted only while there is reading to do: the first
//   message mounts it, and it is let go a minute after the last answer (the
//   reader page holds ~106 MB of wasm memory).
// - Messages wait until the page says {type:'ready'}: a fresh page has no
//   listener before its script runs.
// - remount() (a read that hung) gives the WebView a new key, so React
//   mounts a fresh one.
// - gone() (the page failed to load, or the WebView's process died) tells
//   the reader (its read in flight fails as not the photo's), drops what was
//   waiting and UNMOUNTS: the next photo, under the read loop's backoff,
//   mounts a fresh page. After three failures in a row without a ready page
//   it stops mounting for five minutes and fails each read at once, so an
//   unreachable page (offline, captive portal, not deployed) costs nothing.
// - close() (sign-out) unmounts at once and drops whatever was waiting.

export interface ReaderChannelSnapshot {
  /** Whether ReaderHost renders the WebView. */
  mounted: boolean;
  /** The WebView's React key: a new one mounts a fresh page. */
  key: number;
}

export interface ReaderChannel {
  /** Reader side: send one message to the page (queued until it is ready). */
  post(msg: string): void;
  /**
   * Reader side: where the page's messages (its ready line and its answers)
   * go, the page failing (gone), and the page being let go idle (unloaded: the
   * next one loads the reader afresh, nothing failed).
   */
  connect(to: ReaderEnd | null): void;
  /** Reader side: a read hung; start a fresh page. */
  remount(): void;
  /** Sign-out: unmount now and drop everything waiting. */
  close(): void;
  /** Host side: the mounted WebView's postMessage, or null when it is unmounted. */
  attach(sink: ((msg: string) => void) | null): void;
  /** Host side: a message from the page. */
  receive(data: string): void;
  /** Host side: the WebView's content process ended or the page failed to load. */
  gone(): void;
  snapshot(): ReaderChannelSnapshot;
  subscribe(fn: () => void): () => void;
}

export interface ReaderEnd {
  receive(data: string): void;
  gone(): void;
  unloaded?(): void;
}

/** Failures in a row without a ready page before the channel stops mounting for a while. */
const MAX_GONE = 3;
const GONE_COOLDOWN_MS = 5 * 60_000;

export function createReaderChannel(opts: { idleMs?: number; now?: () => number } = {}): ReaderChannel {
  const idleMs = opts.idleMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  let goneStreak = 0;
  let lastGoneAt = 0;
  let snap: ReaderChannelSnapshot = { mounted: false, key: 0 };
  let sink: ((msg: string) => void) | null = null;
  let ready = false;
  let queue: string[] = [];
  let reader: ReaderEnd | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: ReaderChannelSnapshot) => {
    if (next.mounted === snap.mounted && next.key === snap.key) return;
    snap = next;
    for (const fn of [...listeners]) fn();
  };
  const clearIdle = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };
  const flush = () => {
    if (!ready || !sink) return;
    const out = queue;
    queue = [];
    for (const m of out) sink(m);
  };
  const fresh = () => {
    ready = false;
    set({ mounted: true, key: snap.key + 1 });
  };

  return {
    post(msg) {
      clearIdle();
      if (goneStreak >= MAX_GONE && now() - lastGoneAt < GONE_COOLDOWN_MS) {
        // The page keeps failing: no mount, and the read fails at once (unavailable).
        reader?.gone();
        return;
      }
      queue.push(msg);
      if (!snap.mounted) {
        ready = false;
        set({ mounted: true, key: snap.key });
      }
      flush();
    },
    connect(to) {
      reader = to;
    },
    remount() {
      clearIdle();
      fresh();
    },
    close() {
      clearIdle();
      queue = [];
      ready = false;
      set({ mounted: false, key: snap.key + 1 });
    },
    attach(next) {
      sink = next;
      if (!next) ready = false;
      flush();
    },
    receive(data) {
      let msg: unknown = null;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg && typeof msg === "object" && (msg as { type?: unknown }).type === "ready") {
        ready = true;
        goneStreak = 0;
        // The reader learns from it whether this WebView can read at all.
        reader?.receive(data);
        flush();
        return;
      }
      reader?.receive(data);
      if (queue.length === 0) {
        clearIdle();
        idle = setTimeout(() => {
          idle = null;
          ready = false;
          reader?.unloaded?.();
          set({ mounted: false, key: snap.key });
        }, idleMs);
        // Node (jest) only: the idle unload never holds the process open. On a
        // phone the handle is a number and there is nothing to call.
        (idle as { unref?: () => void }).unref?.();
      }
    },
    gone() {
      clearIdle();
      queue = [];
      ready = false;
      goneStreak++;
      lastGoneAt = now();
      reader?.gone();
      set({ mounted: false, key: snap.key + 1 });
    },
    snapshot: () => snap,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The one channel the app's reader port and ReaderHost share. */
export const personasReaderChannel = createReaderChannel();
