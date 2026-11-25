// The phone's PersonasEngine ports. Ported from
// apps/web/src/lib/personas-device/ports.ts - keep the behaviour in step.
//
// Mobile differences: requests carry the bearer token (a 401 refreshes the
// session once, as apiRequest does), the sealed snapshot cache is the
// personas_cache table in SQLite, and the engine's per-user key record lives
// in the secure store under personas_key_v2_<userId>, on this device only.
//
// Only sealed bytes and the sealed key leave the device through here; the
// photo source sends nothing but the listing and rendition requests the app
// makes to show the same photos.
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import {
  JournalFullError, JournalGoneError, KeyExistsError, ReaderUnsupportedError,
  type Candidate, type FileSource, type JournalApi, type KeyStore, type LocalCache,
} from "@dosya-dev/personas-engine";
import { API_BASE_URL } from "@/api/config";
import { getAccessToken, refreshSession } from "@/auth/authStore";
import { base64ToBytes, bytesToBase64 } from "@/player/metadata/base64";
import { timedSignal, untilAborted } from "./abort";
import { PersonasUnavailableError } from "./errors";

export interface HttpOptions {
  /** API origin; the app's API_BASE_URL when not given. */
  base?: string;
  fetch?: typeof fetch;
  /** The current access token. */
  token?: () => string | null;
  /** Refresh an expired session (authStore.refreshSession). */
  refresh?: () => Promise<"refreshed" | "rejected" | "unavailable">;
  /** Per-request time limit (React Native's fetch has none); 120 s when not given. */
  timeoutMs?: number;
}

const REQUEST_TIMEOUT_MS = 120_000;
/** A 1600 px rendition is a few hundred KB: a minute is a dead connection. */
const RENDITION_TIMEOUT_MS = 60_000;

/** A request that ran out of time (not the photo's fault: try later). */
export class PersonasTimeoutError extends Error {
  constructor(path: string) {
    super(`personas: request timed out (${path.split("?")[0]})`);
    this.name = "PersonasTimeoutError";
  }
}

/** A Personas request the API refused; `code` is the API's error string when it sent one. */
export class PersonasHttpError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`personas: HTTP ${status}${code ? ` ${code}` : ""}`);
    this.name = "PersonasHttpError";
  }
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

async function httpError(res: Response): Promise<PersonasHttpError> {
  return new PersonasHttpError(res.status, await errorCode(res));
}

type Init = { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer; signal?: AbortSignal; timeoutMs?: number };

function http(opts: HttpOptions) {
  const base = (opts.base ?? API_BASE_URL).replace(/\/+$/, "");
  const f = opts.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const token = opts.token ?? getAccessToken;
  const refresh = opts.refresh ?? refreshSession;
  const send = (path: string, init: Init, signal: AbortSignal) => {
    const t = token();
    const headers = { ...(init.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
    const { timeoutMs: _t, signal: _s, ...rest } = init;
    // Raced as well: a fetch that ignores its signal still cannot outlive it.
    return untilAborted(f(`${base}${path}`, { ...rest, headers, signal } as RequestInit), signal);
  };
  /**
   * The response. Rejects with PersonasTimeoutError when the time limit
   * passes first, and with an AbortError when `init.signal` aborts. (React
   * Native's fetch resolves once the whole body is in, so the limit covers
   * the body too.)
   */
  return async (path: string, init: Init = {}): Promise<Response> => {
    const limit = timedSignal(init.timeoutMs ?? opts.timeoutMs ?? REQUEST_TIMEOUT_MS, init.signal);
    try {
      const res = await send(path, init, limit.signal);
      if (res.status !== 401) return res;
      if ((await refresh()) !== "refreshed") return res;
      return await send(path, init, limit.signal);
    } catch (e) {
      if (limit.timedOut()) throw new PersonasTimeoutError(path);
      throw e;
    } finally {
      limit.clear();
    }
  };
}

// ---- journal --------------------------------------------------------------

const JOURNAL_PAGE = 200;

const seqOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isSafeInteger(v));

/** /api/e2ee/personas/key and /api/e2ee/personas/:workspaceId/journal. */
export function mobileJournalApi(opts: HttpOptions = {}): JournalApi {
  const call = http(opts);
  const journal = (ws: string) => `/api/e2ee/personas/${encodeURIComponent(ws)}/journal`;
  const ok = async (res: Response) => {
    if (!res.ok) throw await httpError(res);
  };
  return {
    async getKey() {
      const res = await call("/api/e2ee/personas/key");
      if (res.status === 404) return null;
      await ok(res);
      const body = (await res.json()) as { enc?: unknown; ct?: unknown };
      if (typeof body?.enc !== "string" || typeof body?.ct !== "string") throw new Error("personas: malformed key response");
      return { enc: body.enc, ct: body.ct };
    },
    async putKey(sealed) {
      const res = await call("/api/e2ee/personas/key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enc: sealed.enc, ct: sealed.ct }),
      });
      if (res.status === 409) throw new KeyExistsError();
      await ok(res);
    },
    async deleteKey() {
      await ok(await call("/api/e2ee/personas/key", { method: "DELETE" }));
    },
    async head(workspaceId) {
      const res = await call(`${journal(workspaceId)}?head=1`);
      await ok(res);
      const body = (await res.json()) as { first_seq?: unknown; last_seq?: unknown };
      if (!seqOrNull(body?.first_seq) || !seqOrNull(body?.last_seq)) throw new Error("personas: malformed journal head");
      return { first_seq: body.first_seq, last_seq: body.last_seq };
    },
    async pull(workspaceId, after) {
      const res = await call(`${journal(workspaceId)}?after=${after}&limit=${JOURNAL_PAGE}`);
      await ok(res);
      const body = (await res.json()) as { batches?: unknown; next?: unknown; first_seq?: unknown };
      if (!Array.isArray(body?.batches) || !(body.next === null || typeof body.next === "number")) {
        throw new Error("personas: malformed journal page");
      }
      if (body.first_seq !== undefined && !seqOrNull(body.first_seq)) throw new Error("personas: malformed journal page");
      const batches = body.batches.map((b: { seq?: unknown; body?: unknown }) => {
        if (typeof b?.seq !== "number" || typeof b.body !== "string") throw new Error("personas: malformed journal batch");
        return { seq: b.seq, body: base64ToBytes(b.body) };
      });
      return body.first_seq === undefined ? { batches, next: body.next } : { batches, next: body.next, first_seq: body.first_seq };
    },
    async append(workspaceId, body, o) {
      const res = await call(`${journal(workspaceId)}${o?.create ? "?create=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: body.slice().buffer as ArrayBuffer,
      });
      if (res.status === 409) {
        const code = await errorCode(res);
        if (code === "personas_journal_gone") throw new JournalGoneError();
        throw new PersonasHttpError(409, code);
      }
      if (res.status === 413) {
        const code = await errorCode(res);
        if (code === "personas_journal_full" || code === "personas_quota") throw new JournalFullError(code);
        throw new PersonasHttpError(413, code);
      }
      await ok(res);
      const r = (await res.json()) as { seq?: unknown };
      if (typeof r?.seq !== "number") throw new Error("personas: malformed append response");
      return { seq: r.seq };
    },
    async deleteJournal(workspaceId) {
      await ok(await call(journal(workspaceId), { method: "DELETE" }));
    },
  };
}

// ---- snapshot cache -------------------------------------------------------

/** What the cache needs of an expo-sqlite database (tests pass a fake). */
export type CacheDb = Pick<SQLite.SQLiteDatabase, "execAsync" | "getFirstAsync" | "runAsync">;

const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS personas_cache (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  snapshot BLOB NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);
`;

export async function openCacheDb(): Promise<SQLite.SQLiteDatabase> {
  return SQLite.openDatabaseAsync("personas.db");
}

/** Sealed snapshots (the engine seals them with the workspace key), one row per user and workspace. */
export function sqliteLocalCache(open: () => Promise<CacheDb> = openCacheDb): LocalCache {
  let ready: Promise<CacheDb> | null = null;
  const db = () => {
    ready ??= open().then(async (d) => {
      await d.execAsync(CACHE_SCHEMA);
      return d;
    });
    ready.catch(() => { ready = null; });
    return ready;
  };
  return {
    async load(userId, workspaceId) {
      const row = await (await db()).getFirstAsync<{ snapshot: unknown }>(
        "SELECT snapshot FROM personas_cache WHERE user_id = ? AND workspace_id = ?", userId, workspaceId,
      );
      return row?.snapshot instanceof Uint8Array ? row.snapshot.slice() : null;
    },
    async save(userId, workspaceId, sealed) {
      await (await db()).runAsync(
        "INSERT OR REPLACE INTO personas_cache (user_id, workspace_id, snapshot) VALUES (?, ?, ?)", userId, workspaceId, sealed.slice(),
      );
    },
    async clear(userId, workspaceId) {
      if (workspaceId !== undefined) {
        await (await db()).runAsync("DELETE FROM personas_cache WHERE user_id = ? AND workspace_id = ?", userId, workspaceId);
        return;
      }
      await (await db()).runAsync("DELETE FROM personas_cache WHERE user_id = ?", userId);
    },
  };
}

/** Whether this device still holds a sealed snapshot for any workspace of the user. */
export async function sqliteHasSnapshots(open: () => Promise<CacheDb> = openCacheDb, userId: string): Promise<boolean> {
  const d = await open();
  await d.execAsync(CACHE_SCHEMA);
  const row = await d.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM personas_cache WHERE user_id = ?", userId);
  return (row?.n ?? 0) > 0;
}

// ---- key store ------------------------------------------------------------

/** What the key store needs of expo-secure-store (tests pass a fake). */
export type SecretStore = Pick<typeof SecureStore, "getItemAsync" | "setItemAsync" | "deleteItemAsync">;

/**
 * This device only, readable from the first unlock after boot: the key never
 * goes into a backup or to another device, and a background Personas window
 * runs with the phone locked.
 */
const KEY_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/**
 * The v1 item was created WHEN_UNLOCKED_THIS_DEVICE_ONLY. SecItemUpdate keeps
 * an item's accessibility class, so it cannot be changed in place (see
 * src/lib/keychain.ts): v2 is a new name, and v1 is only read and deleted.
 */
const V1_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** The secure store accepts letters, digits, ".", "-" and "_" in a key name. */
const safeId = (userId: string) =>
  /^[A-Za-z0-9._-]+$/.test(userId) ? userId : `x${bytesToBase64(new TextEncoder().encode(userId)).replace(/[^A-Za-z0-9]/g, (c) => (c === "+" ? "-" : c === "/" ? "." : ""))}`;
const keyName = (userId: string) => `personas_key_v2_${safeId(userId)}`;
const legacyKeyName = (userId: string) => `personas_key_${safeId(userId)}`;

/**
 * The engine's per-user key record (the personas key and a check value),
 * base64 in the secure store. An unreadable entry reads as no key (the
 * engine then shows the unlock gate). A v1 entry is moved to v2 on its first
 * read (write v2, then delete v1; a failed write leaves v1 for the next read).
 */
export function secureKeyStore(store: SecretStore = SecureStore): KeyStore {
  return {
    async get(userId) {
      try {
        const v = await store.getItemAsync(keyName(userId), KEY_OPTIONS);
        if (v) return base64ToBytes(v);
        // A locked phone throws here (v1 is WHEN_UNLOCKED): reads as no key.
        const old = await store.getItemAsync(legacyKeyName(userId), V1_OPTIONS);
        if (!old) return null;
        const bytes = base64ToBytes(old);
        try {
          await store.setItemAsync(keyName(userId), old, KEY_OPTIONS);
          await store.deleteItemAsync(legacyKeyName(userId), V1_OPTIONS);
        } catch {
          /* the key is in hand; the move is retried by the next read */
        }
        return bytes;
      } catch {
        return null;
      }
    },
    async set(userId, key) {
      await store.setItemAsync(keyName(userId), bytesToBase64(key), KEY_OPTIONS);
    },
    async clear(userId) {
      const r = await Promise.allSettled([
        store.deleteItemAsync(keyName(userId), KEY_OPTIONS),
        store.deleteItemAsync(legacyKeyName(userId), V1_OPTIONS),
      ]);
      const bad = r.find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
      if (bad) throw bad.reason;
    },
  };
}

// ---- photo source ---------------------------------------------------------

export interface FileSourceOptions extends HttpOptions {
  now?: () => number;
  /** How long a workspace's full candidate listing is reused. */
  ttlMs?: number;
}

const LISTING_TTL_MS = 5 * 60_000;
const LIBRARY_PAGE = 200;
/** Renditions are about 1600 px; anything far larger is an original the thumb route redirected to, not worth reading here. */
const MAX_RENDITION_BYTES = 32 * 1024 * 1024;
const READABLE_TYPES = ["image/jpeg", "image/webp"];
const MAX_DEPTH = 256;

interface TreeFolder {
  id: string;
  parent_id: string | null;
  is_hidden: number;
  lock_mode: string;
  /** A folder-confined member's anchor only: a folder above it is hidden (1) or locked (1). */
  inherited_hidden?: number;
  inherited_lock?: number;
}

/** One row of GET /api/library (the fields the file rows carry; the persona screen shows them). */
export interface PhotoRow {
  id: string;
  name?: string;
  size_bytes?: number;
  mime_type?: string;
  extension?: string | null;
  region?: string;
  uploaded_by?: string;
  updated_at?: number | null;
  folder_id: string | null;
  current_version?: number | null;
  taken_at?: number | null;
  created_at?: number | null;
  is_hidden?: number | null;
  lock_mode?: string | null;
}

/** Any lock at all, whether or not this user holds an unlock token for it. */
const locked = (mode: string | null | undefined) => !!mode && mode !== "none";

/**
 * Every photo the user can list in the workspace: GET /api/library?kind=photos
 * minus every file that is hidden (for anyone) or locked itself, or sits
 * under a folder that is (flags from one GET /api/folders/tree?flags=1, which
 * also gives each file's ancestry). A file whose folder is not in the tree is
 * left out too. Any listing error throws (an empty list would take every
 * photo out of every persona). The full listing is kept for five minutes per
 * workspace.
 */
export interface MobileFileSource extends FileSource {
  /** The rows of the photos `candidates` lists, by id, from the same cached listing (the same Map until it is made again). */
  photos(workspaceId: string): Promise<ReadonlyMap<string, PhotoRow>>;
}

interface Listing { candidates: Candidate[]; rows: ReadonlyMap<string, PhotoRow> }

export function mobileFileSource(opts: FileSourceOptions = {}): MobileFileSource {
  const call = http(opts);
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.ttlMs ?? LISTING_TTL_MS;
  const cache = new Map<string, { at: number; list: Promise<Listing> }>();

  async function getJson<T>(path: string): Promise<T> {
    const res = await call(path);
    if (!res.ok) throw await httpError(res);
    return (await res.json()) as T;
  }

  async function tree(ws: string): Promise<Map<string, TreeFolder>> {
    const body = await getJson<{ ok?: unknown; folders?: unknown }>(`/api/folders/tree?workspace_id=${encodeURIComponent(ws)}&flags=1`);
    if (body?.ok !== true || !Array.isArray(body.folders)) throw new Error("personas: malformed folder tree");
    const map = new Map<string, TreeFolder>();
    for (const f of body.folders as Partial<TreeFolder>[]) {
      if (!f || typeof f.id !== "string") continue;
      // Without its flags a folder cannot be judged: stop rather than read under a hidden or locked folder.
      if (typeof f.is_hidden !== "number" || typeof f.lock_mode !== "string") throw new Error("personas: folder tree without hidden and lock flags");
      map.set(f.id, f as TreeFolder);
    }
    return map;
  }

  /**
   * The folders above `folder` (nearest first), or null if `folder` is not in
   * the tree or it or a folder above is hidden or locked. A listed folder's
   * parent is missing from the tree only above a folder-confined member's
   * anchor: the walk stops there, and the anchor's inherited flags say
   * whether a folder above it is hidden or locked (missing flags fail closed).
   */
  function ancestry(folders: Map<string, TreeFolder>, folder: string): string[] | null {
    if (!folders.has(folder)) return null;
    const out: string[] = [];
    const seen = new Set<string>();
    let id: string | null = folder;
    while (id !== null) {
      const f = folders.get(id);
      if (!f) {
        const top = folders.get(out.length ? out[out.length - 1] : folder)!;
        if (top.inherited_hidden !== 0 || top.inherited_lock !== 0) return null;
        break;
      }
      if (seen.has(id) || seen.size > MAX_DEPTH || f.is_hidden === 1 || locked(f.lock_mode)) return null;
      seen.add(id);
      if (id !== folder) out.push(id);
      id = f.parent_id ?? null;
    }
    return out;
  }

  async function library(ws: string): Promise<PhotoRow[]> {
    const rows: PhotoRow[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const qs = new URLSearchParams({ workspace_id: ws, kind: "photos", sort: "taken_desc", limit: String(LIBRARY_PAGE) });
      if (cursor) qs.set("cursor", cursor);
      const body = await getJson<{ ok?: unknown; months?: unknown; next_cursor?: unknown }>(`/api/library?${qs.toString()}`);
      if (body?.ok !== true || !Array.isArray(body.months)) throw new Error("personas: malformed photo listing");
      for (const m of body.months as { files?: unknown }[]) {
        if (!Array.isArray(m?.files)) throw new Error("personas: malformed photo listing");
        for (const r of m.files as PhotoRow[]) if (r && typeof r.id === "string") rows.push(r);
      }
      const next = body.next_cursor;
      if (next === null || next === undefined) return rows;
      if (typeof next !== "string" || cursors.has(next)) throw new Error("personas: photo listing does not end");
      cursors.add(next);
      cursor = next;
    }
  }

  async function listing(ws: string): Promise<Listing> {
    let folders = await tree(ws);
    const rows = await library(ws);
    // A folder made between the two requests: look at the tree once more.
    if (rows.some((r) => r.folder_id && !folders.has(r.folder_id))) folders = await tree(ws);
    const out: Candidate[] = [];
    const byId = new Map<string, PhotoRow>();
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.id) || r.is_hidden === 1 || locked(r.lock_mode)) continue;
      const folder = typeof r.folder_id === "string" && r.folder_id ? r.folder_id : null;
      const ancestors = folder === null ? [] : ancestry(folders, folder);
      if (!ancestors) continue;
      seen.add(r.id);
      byId.set(r.id, r);
      const ver = Number(r.current_version);
      const at = Number(r.taken_at ?? r.created_at);
      out.push({ file: r.id, ver: Number.isSafeInteger(ver) && ver >= 1 ? ver : 1, folder, ancestors, sortAt: Number.isFinite(at) ? at : 0 });
    }
    return { candidates: out, rows: byId };
  }

  function cached(ws: string): Promise<Listing> {
    const hit = cache.get(ws);
    if (hit && now() - hit.at < ttl) return hit.list;
    const list = listing(ws);
    const entry = { at: now(), list };
    cache.set(ws, entry);
    list.catch(() => {
      if (cache.get(ws) === entry) cache.delete(ws);
    });
    return list;
  }

  return {
    async *candidates(workspaceId) {
      yield* (await cached(workspaceId)).candidates;
    },
    async photos(workspaceId) {
      return (await cached(workspaceId)).rows;
    },
    /**
     * 404 and 415 are the photo's (gone, or no rendition), as is anything
     * that is not a JPEG or WebP; a network error and every other refusal
     * (signed out, forbidden right now, rate limited, server trouble) is
     * PersonasUnavailableError, which the host turns into "try later".
     */
    async rendition(file, ver, signal) {
      // One limit for the request and its body: a stalled download fails as
      // "try later", and the caller's abort (the window or the loop) ends it.
      const limit = timedSignal(RENDITION_TIMEOUT_MS, signal);
      const unavailable = (e: unknown) => {
        // The caller gave up: not a network failure.
        if (signal?.aborted) return e;
        return new PersonasUnavailableError(limit.timedOut() ? "personas: rendition timed out" : e instanceof Error ? e.message : String(e));
      };
      try {
        let res: Response;
        try {
          res = await call(`/api/files/${encodeURIComponent(file)}/thumb?w=1600&version=${ver}`, { signal: limit.signal, timeoutMs: RENDITION_TIMEOUT_MS });
        } catch (e) {
          throw unavailable(e);
        }
        if (!res.ok) {
          if (res.status === 404 || res.status === 415) throw await httpError(res);
          throw new PersonasUnavailableError(`personas: rendition HTTP ${res.status}`);
        }
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const declared = Number(res.headers.get("content-length"));
        if (!READABLE_TYPES.includes(type) || (Number.isFinite(declared) && declared > MAX_RENDITION_BYTES)) throw new ReaderUnsupportedError();
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await untilAborted(res.arrayBuffer(), limit.signal));
        } catch (e) {
          throw unavailable(e); // the body broke off, or stalled
        }
        if (bytes.length > MAX_RENDITION_BYTES) throw new ReaderUnsupportedError();
        return bytes;
      } finally {
        limit.clear();
      }
    },
  };
}
