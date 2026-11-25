// The phone's FaceReaderPort. React Native's Hermes cannot run WebAssembly,
// so photos are read by the web app's reader page (apps/web/personas-reader.html)
// in a hidden WebView (./ReaderHost.tsx): each photo goes over as base64 and
// its faces come back as plain numbers. Mirrors apps/web/src/lib/personas-device/reader.ts:
// one read at a time, 120 s for a read while the reader loads and 60 s once
// it has, and a hung read is the reader's fault before it loaded and the
// photo's after.
//
// Faces only ever travel between this app and the page it loaded; nothing is
// logged or sent anywhere else.
import { ReaderUnsupportedError, type FaceReaderPort, type ReadFace } from "@dosya-dev/personas-engine";
import { bytesToBase64 } from "@/player/metadata/base64";
import { PersonasUnavailableError } from "./errors";

/**
 * The reader could not load (the WebView, the wasm or a model failed to
 * load, or did not match its SHA-256). Not the photo's fault: engine-host
 * aborts the read so the engine journals nothing for it, and tries again later.
 */
export class ReaderUnavailableError extends PersonasUnavailableError {
  constructor(message = "face reader unavailable") {
    super(message);
    this.name = "ReaderUnavailableError";
  }
}

export interface WebViewReaderOptions {
  /** A read hung: the host remounts the WebView (a fresh page loads the reader again). */
  onStuck?: () => void;
  /** Longest one read may take once the reader has loaded. */
  readTimeoutMs?: number;
  /** Longest a read may take while the page still loads the reader. */
  loadTimeoutMs?: number;
}

export interface WebViewReader extends FaceReaderPort {
  /** A message from the page: its ready line or an answer. */
  onMessage(data: string): void;
  /**
   * Whether this phone's WebView can run the reader, from the page's ready
   * line: null until a page has said. False: every read fails at once as
   * unavailable and the host stops reading.
   */
  supported(): boolean | null;
  /** Called when supported() changes. */
  onSupported(fn: () => void): () => void;
  /** The page was let go idle: nothing fails, the next page loads the reader again. */
  unloaded(): void;
  /** The WebView went away (process ended, unmounted): the read in flight fails, the next page loads afresh. */
  reset(): void;
  /** Sign-out: the read in flight fails as unavailable. */
  dispose(): void;
}

const SIG_LEN = 128;

type Pending = { id: number; resolve: (f: ReadFace[]) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> };

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** The page's faces, checked: null when anything is off. */
function parseFaces(raw: unknown): ReadFace[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ReadFace[] = [];
  for (const f of raw as { box?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }; sig?: unknown; score?: unknown }[]) {
    const b = f?.box;
    if (!b || !finite(b.x) || !finite(b.y) || !finite(b.w) || !finite(b.h) || !finite(f.score)) return null;
    if (!Array.isArray(f.sig) || f.sig.length !== SIG_LEN || !f.sig.every(finite)) return null;
    out.push({ box: { x: b.x, y: b.y, w: b.w, h: b.h }, sig: Float32Array.from(f.sig as number[]), score: f.score });
  }
  return out;
}

/**
 * A FaceReaderPort reading in the WebView. `post` hands one JSON message to
 * the page (personasReaderChannel.post); the page's messages come back
 * through onMessage.
 */
export function createWebViewReader(post: (msg: string) => void, opts: WebViewReaderOptions = {}): WebViewReader {
  const readTimeoutMs = opts.readTimeoutMs ?? 60_000;
  const loadTimeoutMs = opts.loadTimeoutMs ?? 120_000;
  /** The current page has answered at least once with its reader loaded. */
  let loaded = false;
  let pending: Pending | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let nextId = 1;
  /** Bumped when the reader proved unavailable or was let go: reads queued before fail at once. */
  let epoch = 0;
  let canRead: boolean | null = null;
  const supportedFns = new Set<() => void>();

  const settle = (p: Pending) => {
    clearTimeout(p.timer);
    if (pending === p) pending = null;
  };

  /** The page is gone or stuck: the read in flight fails, and the next page must load the reader again. */
  const fail = (wasLoaded: boolean, stuck: boolean) => {
    const p = pending;
    loaded = false;
    if (!p) return;
    settle(p);
    p.reject(wasLoaded ? new Error(stuck ? "face reader timed out" : "face reader stopped") : new ReaderUnavailableError(stuck ? "face reader timed out loading" : "face reader stopped"));
  };

  const readNow = (photo: Uint8Array): Promise<ReadFace[]> =>
    new Promise<ReadFace[]>((resolve, reject) => {
      if (canRead === false) {
        reject(new ReaderUnavailableError("this WebView cannot run the face reader"));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending?.id !== id) return;
        fail(loaded, true);
        opts.onStuck?.();
      }, loaded ? readTimeoutMs : loadTimeoutMs);
      const p: Pending = { id, resolve, reject, timer };
      pending = p;
      try {
        post(JSON.stringify({ id, photoBase64: bytesToBase64(photo) }));
      } catch (e) {
        settle(p);
        reject(new ReaderUnavailableError(e instanceof Error ? e.message : String(e)));
      }
    });

  return {
    read(photo) {
      // Reads queued behind one that found the reader unavailable, or queued
      // when the reader was let go, fail at once instead of each waiting out
      // the load timeout (the engine keeps several photos in flight).
      const at = epoch;
      const run = queue.then(() => {
        if (at !== epoch) throw new ReaderUnavailableError("face reader stopped");
        return readNow(photo);
      });
      queue = run.catch((e) => {
        if (e instanceof ReaderUnavailableError && at === epoch) epoch++;
      });
      return run;
    },
    onMessage(data) {
      let msg: { id?: unknown; faces?: unknown; error?: unknown; type?: unknown; supported?: unknown } | null = null;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg && typeof msg === "object" && msg.type === "ready") {
        const next = msg.supported !== false;
        if (next !== canRead) {
          canRead = next;
          for (const fn of [...supportedFns]) fn();
        }
        return;
      }
      const p = pending;
      if (!msg || typeof msg !== "object" || !p || msg.id !== p.id) return;
      settle(p);
      if (msg.error === "unavailable") {
        p.reject(new ReaderUnavailableError("face reader could not load"));
        return;
      }
      loaded = true;
      if (msg.error === "unsupported") {
        p.reject(new ReaderUnsupportedError());
        return;
      }
      const faces = msg.error === undefined ? parseFaces(msg.faces) : null;
      if (faces) p.resolve(faces);
      else p.reject(new Error(msg.error === "failed" ? "face reader failed on this photo" : "face reader answered something unreadable"));
    },
    reset() {
      fail(loaded, false);
    },
    supported: () => canRead,
    onSupported(fn) {
      supportedFns.add(fn);
      return () => {
        supportedFns.delete(fn);
      };
    },
    unloaded() {
      loaded = false;
    },
    dispose() {
      epoch++;
      fail(false, false);
    },
  };
}
