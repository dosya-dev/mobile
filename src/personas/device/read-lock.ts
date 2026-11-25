// One reading run at a time (spec 11.1). At most one of the foreground read
// loops, the iOS processing window, the iOS continued task, the Android
// service run and the Android worker run reads at once. Process-wide: every
// owner lives in this one JS runtime.
import type { WindowKind } from "./background";

export type ReadLockOwner = "foreground" | WindowKind;

let holder: { owner: ReadLockOwner; token: object } | null = null;
const fns = new Set<() => void>();

const announce = () => {
  for (const fn of [...fns]) {
    try {
      fn();
    } catch {
      /* a listener's failure is its own */
    }
  }
};

/** Take the lock; null while someone else holds it. The returned function lets it go (once). */
export function acquireReadLock(owner: ReadLockOwner): (() => void) | null {
  if (holder) return null;
  const token = {};
  holder = { owner, token };
  announce();
  return () => {
    if (holder?.token !== token) return;
    holder = null;
    announce();
  };
}

/** Who holds the lock now, if anyone. */
export function readLockOwner(): ReadLockOwner | null {
  return holder?.owner ?? null;
}

/** Called whenever the lock is taken or let go. */
export function subscribeReadLock(fn: () => void): () => void {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
}
