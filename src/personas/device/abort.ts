// A request timeout that also follows a caller's signal. React Native's fetch
// has no timeout of its own (Android's OkHttp timeouts are 0: a stalled
// connection waits forever), and Hermes has no AbortSignal.any or
// AbortSignal.timeout, so a background window would otherwise hold the read
// lock for as long as a dead connection stays open.

export interface TimedSignal {
  /** Aborts when `parent` aborts or `ms` pass, whichever is first. */
  signal: AbortSignal;
  /** True when it was the time limit, not the parent, that aborted it. */
  timedOut(): boolean;
  /** Stop the timer and stop following the parent. Call once the request settled. */
  clear(): void;
}

export function timedSignal(ms: number, parent?: AbortSignal | null): TimedSignal {
  const ac = new AbortController();
  let expired = false;
  const onParent = () => ac.abort();
  const timer = setTimeout(() => {
    expired = true;
    ac.abort();
  }, ms);
  if (parent?.aborted) ac.abort();
  else parent?.addEventListener("abort", onParent);
  return {
    signal: ac.signal,
    timedOut: () => expired && !parent?.aborted,
    clear() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

/**
 * `p`, but rejected once `signal` aborts (a fetch that ignores its signal, or
 * a body read that never ends, cannot outlive it). `p` is left to settle on
 * its own.
 */
export function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      p.catch(() => undefined);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort);
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}
