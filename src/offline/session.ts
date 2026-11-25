import * as FileSystem from "expo-file-system/legacy";

/**
 * Who the offline store currently belongs to, and the one lock every change to
 * it goes through.
 *
 * Downloads are slow and run outside any lock; deciding what a finished
 * download is allowed to become is fast and runs inside it. The lock exists so
 * an unpin, a sign-out or a Remove all can never interleave with that decision:
 * whichever of them gets the lock first wins outright, and the loser sees the
 * world the winner left behind (for a publish, "no pin covers this any more";
 * for anything after a sign-out, a fenced session that writes nothing).
 */

/** Everything offline lives under here, one directory per account. */
export const OFFLINE_ROOT = `${FileSystem.documentDirectory ?? ""}offline/`;

export interface OfflineSession {
  accountId: string;
  /** Changes on every begin and end; a session object from an older one is fenced. */
  generation: number;
  /** `${OFFLINE_ROOT}${accountId}/`, holding offline.db, files/ and tmp/. */
  root: string;
}

export interface CancellableTask {
  cancelAsync(): Promise<void>;
}

let session: OfflineSession | null = null;
let generation = 0;
const tasks = new Map<string, Set<CancellableTask>>();
let tail: Promise<void> = Promise.resolve();

/**
 * A path segment, never a path: ids are opaque server strings and must not be
 * able to name a directory outside the offline root.
 */
function segment(accountId: string): string {
  const s = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return s.length > 0 ? s : "_";
}

/** The directory an account's offline data lives in. */
export function accountRoot(accountId: string): string {
  return `${OFFLINE_ROOT}${segment(accountId)}/`;
}

export function currentSession(): OfflineSession | null {
  return session;
}

/**
 * Start (or keep) the session for an account. Idempotent for the account
 * already running, so the shell can call it on every render that knows the user.
 * Another account's session is fenced the moment this one begins; its cleanup
 * is the purge's job (endSession + wipeAccount), not this function's.
 */
export function beginSession(accountId: string): OfflineSession {
  if (session && session.accountId === accountId) return session;
  generation += 1;
  session = { accountId, generation, root: accountRoot(accountId) };
  return session;
}

/** True while `s` is still the live session. Checked inside the lock before any write. */
export function fence(s: OfflineSession): boolean {
  return session !== null && session.generation === s.generation && session.accountId === s.accountId;
}

/** FIFO mutex. A rejection releases the lock like a success does. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Run `fn` holding the commit lock, if `s` is still live once the lock is ours.
 * Null means the session ended while we waited and nothing ran.
 *
 * Never call withCommit from inside `fn`: the lock is not re-entrant, and the
 * inner call would wait for the outer one forever.
 */
export function withCommit<T>(s: OfflineSession, fn: () => Promise<T>): Promise<T | null> {
  return withLock(async () => (fence(s) ? await fn() : null));
}

/**
 * End the session: fence it, stop every transfer, then wait for the lock, so a
 * commit already running finishes before the caller wipes anything. After this
 * resolves no commit from the old session can run.
 */
export async function endSession(): Promise<void> {
  generation += 1;
  session = null;
  const all = [...tasks.values()].flatMap((set) => [...set]);
  tasks.clear();
  await Promise.all(all.map((t) => t.cancelAsync().catch(() => {})));
  await withLock(async () => {});
}

/**
 * Track a running download so unpin and sign-out can stop it. Returns the
 * unregister. Given the session it belongs to, a task registered after that
 * session ended is cancelled on the spot: endSession has already emptied the
 * registry, so nothing else would ever stop it.
 */
export function registerTask(fileId: string, task: CancellableTask, s?: OfflineSession): () => void {
  if (s && !fence(s)) {
    void task.cancelAsync().catch(() => {});
    return () => {};
  }
  let set = tasks.get(fileId);
  if (!set) {
    set = new Set();
    tasks.set(fileId, set);
  }
  set.add(task);
  return () => {
    const cur = tasks.get(fileId);
    if (!cur) return;
    cur.delete(task);
    if (cur.size === 0) tasks.delete(fileId);
  };
}

export async function cancelTasksFor(fileIds: Iterable<string>): Promise<void> {
  const victims: CancellableTask[] = [];
  for (const id of fileIds) {
    const set = tasks.get(id);
    if (!set) continue;
    victims.push(...set);
    tasks.delete(id);
  }
  await Promise.all(victims.map((t) => t.cancelAsync().catch(() => {})));
}

/** Test hook: forget the session, the tasks and the lock. */
export function __resetSessionForTests(): void {
  session = null;
  generation += 1;
  tasks.clear();
  tail = Promise.resolve();
}
