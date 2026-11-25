// The native face reader as the app shares it: one per process, between the
// foreground read loops and the background windows (only one of which reads
// at a time, see ./read-lock.ts).
//
// Its ONNX sessions are let go (spec 11.5) when a background window ends,
// after 60 s with no read, and on a memory warning. unload() never overlaps a
// read: it waits for the reads in flight, and a read asked for while it runs
// starts only after it (a read during unloadModels would start a load that
// the pending unload could then release).
//
// A native read cannot be cancelled from JS. One that has not answered after
// 60 s (the WebView reader's limit) rejects as a failed read, and the reader
// is unusable for the rest of the process: every later read throws
// PersonasUnavailableError (the window ends, the loops wait) and unload no
// longer touches the sessions the hung call may still be using. The next
// process gets a fresh reader.
import type { FaceReaderPort } from "@dosya-dev/personas-engine";
import { PersonasUnavailableError } from "./errors";
import { createNativeReader } from "./native-reader";

export type MemoryWarningSource = (fn: () => void) => () => void;

export interface ManagedReader extends FaceReaderPort {
  unload(): Promise<void>;
  /** Stop the idle timer and the memory-warning subscription. */
  stop(): void;
}

const IDLE_MS = 60_000;
const READ_TIMEOUT_MS = 60_000;

/** A native read that did not answer in time: the photo's read failed. */
export class NativeReadTimeoutError extends Error {
  constructor() {
    super("personas: the native reader did not answer in time");
    this.name = "NativeReadTimeoutError";
  }
}
const noWarnings: MemoryWarningSource = () => () => undefined;

export function createManagedReader(
  base: FaceReaderPort & { unload(): Promise<void> },
  opts: { idleMs?: number; onMemoryWarning?: MemoryWarningSource; readTimeoutMs?: number } = {},
): ManagedReader {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const readTimeoutMs = opts.readTimeoutMs ?? READ_TIMEOUT_MS;
  /** A read hung: nothing more goes to the native side until it answers. */
  let broken = false;
  let hung = 0;
  let inflight = 0;
  let settled: (() => void)[] = [];
  let unloading: Promise<void> | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
  };
  const armIdle = () => {
    clearIdle();
    if (idleMs <= 0) return;
    idle = setTimeout(() => {
      idle = null;
      void unload();
    }, idleMs);
  };

  function unload(): Promise<void> {
    if (unloading) return unloading;
    clearIdle();
    const p = (async () => {
      while (inflight > 0) await new Promise<void>((r) => settled.push(r));
      // A hung call may still be using the sessions: leave them be.
      if (!broken) await base.unload().catch(() => undefined);
    })();
    unloading = p;
    void p.finally(() => {
      if (unloading === p) unloading = null;
    });
    return p;
  }

  const offWarnings = (opts.onMemoryWarning ?? noWarnings)(() => {
    void unload();
  });

  return {
    async read(photo) {
      while (unloading) await unloading;
      if (broken) throw new PersonasUnavailableError("personas: the native reader stopped answering");
      inflight++;
      clearIdle();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        inflight--;
        if (inflight === 0) {
          const waiting = settled;
          settled = [];
          for (const r of waiting) r();
          if (!unloading && !broken) armIdle();
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const call = base.read(photo);
      try {
        return await Promise.race([
          call,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              broken = true;
              hung++;
              clearIdle();
              // When the slow call finally answers, the reader is usable again.
              void call.catch(() => undefined).then(() => {
                if (--hung > 0) return;
                broken = false;
                if (inflight === 0 && !unloading) armIdle();
              });
              reject(new NativeReadTimeoutError());
            }, readTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        finish();
      }
    },
    unload,
    stop() {
      clearIdle();
      offWarnings();
    },
  };
}

let shared: ManagedReader | null = null;
let offWarnings: () => void = () => undefined;

/** The process's native reader (made on first use). */
export function personasNativeReader(): ManagedReader {
  shared ??= createManagedReader(createNativeReader());
  return shared;
}

/** Let the native reader's models go, once the reads in flight settle. No-op if it was never made. */
export function unloadPersonasNativeReader(): Promise<void> {
  return shared ? shared.unload() : Promise.resolve();
}

/**
 * Where memory warnings come from (Task 13 wires the native event: iOS
 * didReceiveMemoryWarning, Android onTrimMemory >= RUNNING_LOW). Until then
 * there are none. Each warning lets the shared reader's models go.
 */
export function setPersonasMemoryWarnings(source: MemoryWarningSource): void {
  offWarnings();
  offWarnings = source(() => {
    void unloadPersonasNativeReader();
  });
}
