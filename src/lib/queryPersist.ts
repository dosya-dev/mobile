import { AppState } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { dehydrate, hydrate, type QueryClient, type DehydratedState } from "@tanstack/react-query";
import { loadUser } from "@/auth/tokenStore";
import { queryClient as appQueryClient } from "./queryClient";

/**
 * The query cache, on disk, so a cold start without a network still opens.
 *
 * react-query keeps everything in memory. Killed and relaunched on the train,
 * the app knew nothing: no workspaces, no folder listing, no file record, so a
 * document the phone already held in the byte store showed "Couldn't load this
 * file" because the METADATA had to be fetched first. This writes the cache to
 * the document directory when the app leaves the foreground and reads it back
 * at launch, before the first screen asks.
 *
 * Built on `dehydrate`/`hydrate` from @tanstack/query-core rather than the
 * persist-client package, which is not a dependency here; the two calls are
 * all that package really wraps.
 *
 * Only reads are persisted, and only the roots that describe the user's data:
 * a search result or an activity feed is not worth a stale copy. Anything read
 * here resolves rather than rejects - a missing, corrupt, foreign or stale file
 * is simply an empty cache, and launch goes on as it always has.
 */

export const QUERY_CACHE_FILE = `${FileSystem.documentDirectory ?? ""}query-cache.json`;
export const PERSISTED_ROOTS: ReadonlySet<string> = new Set(["workspaces", "files", "file", "library", "regions", "me"]);
/** A week: long enough for a holiday without signal, short enough that a
 * renamed or deleted file does not haunt the viewer forever. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * A ceiling on the file, so a big library page or a long listing cannot grow
 * into a multi-megabyte read on the launch path. Past it the oldest entries are
 * dropped until it fits; a file that is somehow over it is ignored rather than
 * parsed.
 */
export const MAX_CACHE_BYTES = 2 * 1024 * 1024;
let maxCacheBytes = MAX_CACHE_BYTES;

/** Test hook: shrink (or, with null, restore) the cap. */
export function __setMaxCacheBytesForTests(bytes: number | null): void {
  maxCacheBytes = bytes ?? MAX_CACHE_BYTES;
}

// 2: entries are stamped with the account that fetched them. The bump is what
// retires every unstamped file written by an older build - there is no way to
// tell whose data one holds, and this whole mechanism exists to make sure the
// answer is never "somebody else's".
const FORMAT_VERSION = 2;

interface PersistedCache {
  v: number;
  savedAt: number;
  /** Whose responses these are. See accountId() for why it is read from disk. */
  account: string;
  state: DehydratedState;
}

/**
 * The signed-in account, from the token store rather than the auth store.
 *
 * Read from disk because the restore path runs BEFORE hydrate() has put
 * anything in memory - that is the point of it, the first screen must not have
 * to wait for the network. `null` whenever the answer is not certain (signed
 * out, or a keychain that would not open), and every caller here treats null as
 * "do not touch the file": fail closed, because the cost of guessing wrong is
 * showing one account another account's workspaces.
 */
async function accountId(): Promise<string | null> {
  try {
    const user = await loadUser<{ id?: unknown }>();
    return typeof user?.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}

function shouldPersist(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === "string" && PERSISTED_ROOTS.has(queryKey[0]);
}

/** Write the client's successful, persistable queries. Best-effort. */
export async function persistQueryCache(client: QueryClient = appQueryClient): Promise<void> {
  try {
    const account = await accountId();
    // Nothing worth keeping belongs to nobody: signed out, the cache holds
    // whatever the purge has not cleared yet, and a file with no owner is one
    // the restore below could never safely hand to anyone.
    if (!account) return;
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === "success" && shouldPersist(q.queryKey),
      shouldDehydrateMutation: () => false,
    });
    // Newest first, so trimming to the cap drops what the user is least
    // likely to open offline.
    const queries = [...state.queries].sort(
      (a, b) => (b.state?.dataUpdatedAt ?? 0) - (a.state?.dataUpdatedAt ?? 0),
    );
    let body = "";
    while (queries.length > 0) {
      body = JSON.stringify({ v: FORMAT_VERSION, savedAt: Date.now(), account, state: { ...state, queries } } satisfies PersistedCache);
      if (body.length <= maxCacheBytes) break;
      queries.pop();
      body = "";
    }
    if (!body) {
      // Not even one entry fits - keep the last good file rather than writing
      // something the launch path would only reject.
      return;
    }
    await FileSystem.writeAsStringAsync(QUERY_CACHE_FILE, body);
  } catch {
    /* storage unavailable - the in-memory cache still serves this session */
  }
}

/**
 * Read the persisted cache into the client. Returns whether anything was
 * restored. Queries a screen has already refreshed win over the file - hydrate
 * only overwrites older data.
 */
export async function restoreQueryCache(client: QueryClient = appQueryClient): Promise<boolean> {
  try {
    const raw = await FileSystem.readAsStringAsync(QUERY_CACHE_FILE);
    // Checked before parsing: an oversized file is not worth the JSON.parse on
    // the launch path, whatever wrote it.
    if (raw.length > maxCacheBytes) return false;
    const parsed = JSON.parse(raw) as Partial<PersistedCache> | null;
    if (!parsed || parsed.v !== FORMAT_VERSION || typeof parsed.savedAt !== "number" || !parsed.state) return false;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return false;
    // Whose cache is this? An account switch purges the file, but the purge is
    // asynchronous and the app can be killed part-way through one - and a
    // launch that restored the PREVIOUS account's `me` and `workspaces` would
    // put another user's name and storage in front of this one. The stamp is
    // what makes that impossible rather than merely unlikely.
    const account = await accountId();
    if (!account || parsed.account !== account) return false;
    if (!Array.isArray(parsed.state.queries)) return false;
    // The whitelist applies on the way IN as well as out. What is on disk was
    // written by some build of this app, not necessarily this one, and a query
    // root we have since decided not to trust offline (a search, an activity
    // feed) must not come back just because an older build wrote it.
    const queries = parsed.state.queries.filter((q) => Array.isArray(q.queryKey) && shouldPersist(q.queryKey));
    if (queries.length === 0) return false;
    hydrate(client, { queries, mutations: [] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist whenever the app leaves the foreground - the last moment the process
 * is reliably ours before the OS may kill it. Returns a disposer.
 */
export function startQueryPersistence(client: QueryClient = appQueryClient): () => void {
  try {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") void persistQueryCache(client);
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Account purge (sign-out): the cache belongs to the account that is leaving. */
export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(QUERY_CACHE_FILE, { idempotent: true });
  } catch {
    /* nothing persisted, or not deletable */
  }
}
