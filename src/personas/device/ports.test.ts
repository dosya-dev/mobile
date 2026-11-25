// The phone's PersonasEngine ports (src/personas/device/ports.ts): the
// journal API with the bearer token, the sealed snapshot cache in SQLite, the
// key in the secure store, and the photo source. Mirrors
// apps/web/src/lib/personas-device/ports.test.ts.
import { JournalFullError, JournalGoneError, KeyExistsError, ReaderUnsupportedError, type Candidate } from "@dosya-dev/personas-engine";
import * as SecureStore from "expo-secure-store";
import { bytesToBase64 } from "@/player/metadata/base64";
import {
  mobileFileSource, mobileJournalApi, PersonasHttpError, secureKeyStore, sqliteHasSnapshots, sqliteLocalCache,
  type CacheDb, type SecretStore,
} from "./ports";
import { PersonasUnavailableError } from "./errors";

jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok", refreshSession: jest.fn(async () => "unavailable") }));

type Call = { url: string; init: RequestInit };

interface FakeRes {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function res(body: unknown, status = 200, headers: Record<string, string> = {}): FakeRes {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => h[n.toLowerCase()] ?? null },
    json: async () => {
      if (typeof body === "string" || body instanceof Uint8Array) throw new SyntaxError("not json");
      return body;
    },
    arrayBuffer: async () => (body instanceof Uint8Array ? body.slice().buffer : new TextEncoder().encode(String(body)).buffer) as ArrayBuffer,
  };
}

function fetchMock(handler: (url: string, init: RequestInit) => FakeRes | Promise<FakeRes>) {
  const calls: Call[] = [];
  const fn = jest.fn(async (input: string, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string> | undefined)?.[name];
const base = "https://api.test";
const auth = { base, token: () => "tok", refresh: async () => "unavailable" as const };

describe("mobileJournalApi", () => {
  it("getKey: GET with the bearer token; 404 is no key; other refusals throw", async () => {
    const m = fetchMock(() => res({ enc: "ZW5j", ct: "Y3Q=" }));
    expect(await mobileJournalApi({ ...auth, fetch: m.fetch }).getKey()).toEqual({ enc: "ZW5j", ct: "Y3Q=" });
    expect(m.calls[0].url).toBe("https://api.test/api/e2ee/personas/key");
    expect(m.calls[0].init.method ?? "GET").toBe("GET");
    expect(header(m.calls[0], "Authorization")).toBe("Bearer tok");
    expect(await mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false }, 404)).fetch }).getKey()).toBeNull();
    const err = await mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false, error: "boom" }, 500)).fetch }).getKey().catch((e) => e);
    expect(err).toBeInstanceOf(PersonasHttpError);
    expect(err.status).toBe(500);
    expect(err.code).toBe("boom");
  });

  it("refreshes an expired session once and tries again", async () => {
    let n = 0;
    const m = fetchMock(() => (n++ === 0 ? res({ ok: false }, 401) : res({ enc: "a", ct: "b" })));
    const refresh = jest.fn(async () => "refreshed" as const);
    expect(await mobileJournalApi({ base, token: () => `t${n}`, refresh, fetch: m.fetch }).getKey()).toEqual({ enc: "a", ct: "b" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(m.calls.map((c) => header(c, "Authorization"))).toEqual(["Bearer t0", "Bearer t1"]);
  });

  it("putKey: PUT JSON; 409 is KeyExistsError", async () => {
    const m = fetchMock(() => res(null, 204));
    await mobileJournalApi({ ...auth, fetch: m.fetch }).putKey({ enc: "ZW5j", ct: "Y3Q=" });
    expect(m.calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual({ enc: "ZW5j", ct: "Y3Q=" });
    expect(header(m.calls[0], "Content-Type")).toBe("application/json");
    const taken = mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false, error: "personas_key_exists" }, 409)).fetch });
    await expect(taken.putKey({ enc: "a", ct: "b" })).rejects.toBeInstanceOf(KeyExistsError);
  });

  it("deleteKey and deleteJournal: DELETE", async () => {
    const m = fetchMock(() => res(null, 204));
    const api = mobileJournalApi({ ...auth, fetch: m.fetch });
    await api.deleteKey();
    await api.deleteJournal("ws/1");
    expect(m.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["DELETE", "https://api.test/api/e2ee/personas/key"],
      ["DELETE", "https://api.test/api/e2ee/personas/ws%2F1/journal"],
    ]);
  });

  it("pull: pages after a sequence and decodes base64 bodies; a malformed page is an error", async () => {
    const m = fetchMock(() => res({ batches: [{ seq: 6, body: bytesToBase64(new Uint8Array([1, 2, 255])) }, { seq: 7, body: "" }], next: 7 }));
    const page = await mobileJournalApi({ ...auth, fetch: m.fetch }).pull("ws1", 5);
    expect(m.calls[0].url).toBe("https://api.test/api/e2ee/personas/ws1/journal?after=5&limit=200");
    expect(page.next).toBe(7);
    expect(Array.from(page.batches[0].body)).toEqual([1, 2, 255]);
    expect(page.batches[1].body).toBeInstanceOf(Uint8Array);
    await expect(mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: true })).fetch }).pull("ws1", 0)).rejects.toThrow();
  });

  it("append: POST raw bytes, create only when asked; 409 gone is JournalGoneError, 413 full or quota is JournalFullError", async () => {
    const m = fetchMock(() => res({ seq: 9 }, 201));
    const api = mobileJournalApi({ ...auth, fetch: m.fetch });
    expect(await api.append("ws1", new Uint8Array([7, 8]))).toEqual({ seq: 9 });
    expect(await api.append("ws1", new Uint8Array([9]), { create: true })).toEqual({ seq: 9 });
    expect(m.calls[0].url).toBe("https://api.test/api/e2ee/personas/ws1/journal");
    expect(m.calls[1].url).toBe("https://api.test/api/e2ee/personas/ws1/journal?create=1");
    expect(m.calls[0].init.method).toBe("POST");
    expect(header(m.calls[0], "Content-Type")).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(m.calls[0].init.body as ArrayBuffer))).toEqual([7, 8]);
    const gone = mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false, error: "personas_journal_gone" }, 409)).fetch });
    await expect(gone.append("ws1", new Uint8Array([1]))).rejects.toBeInstanceOf(JournalGoneError);
    for (const code of ["personas_journal_full", "personas_quota"]) {
      const full = mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false, error: code }, 413)).fetch });
      const err = await full.append("ws1", new Uint8Array([1])).catch((e) => e);
      expect(err).toBeInstanceOf(JournalFullError);
      expect(err.code).toBe(code);
    }
    const big = mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false, error: "personas_batch_too_large" }, 413)).fetch });
    const err = await big.append("ws1", new Uint8Array([1])).catch((e) => e);
    expect(err).toBeInstanceOf(PersonasHttpError);
    expect(err.code).toBe("personas_batch_too_large");
  });

  it("head: GET ?head=1 with the bearer token answers first and last seq, no body; malformed is an error", async () => {
    const m = fetchMock(() => res({ first_seq: 3, last_seq: 9 }));
    expect(await mobileJournalApi({ ...auth, fetch: m.fetch }).head("ws/1")).toEqual({ first_seq: 3, last_seq: 9 });
    expect(m.calls[0].url).toBe("https://api.test/api/e2ee/personas/ws%2F1/journal?head=1");
    expect(header(m.calls[0], "Authorization")).toBe("Bearer tok");
    expect(await mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ first_seq: null, last_seq: null })).fetch }).head("ws1")).toEqual({ first_seq: null, last_seq: null });
    for (const bad of [{}, { first_seq: "3", last_seq: 9 }, { first_seq: 3 }]) {
      await expect(mobileJournalApi({ ...auth, fetch: fetchMock(() => res(bad)).fetch }).head("ws1")).rejects.toThrow();
    }
    await expect(mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ ok: false }, 403)).fetch }).head("ws1")).rejects.toBeInstanceOf(PersonasHttpError);
  });

  it("pull: passes the page's first_seq through (null when empty), and leaves it out when the server sent none", async () => {
    expect(await mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ batches: [], next: null, first_seq: 4 })).fetch }).pull("ws1", 5))
      .toEqual({ batches: [], next: null, first_seq: 4 });
    expect((await mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ batches: [], next: null, first_seq: null })).fetch }).pull("ws1", 5)).first_seq).toBeNull();
    expect("first_seq" in (await mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ batches: [], next: null })).fetch }).pull("ws1", 5))).toBe(false);
    await expect(mobileJournalApi({ ...auth, fetch: fetchMock(() => res({ batches: [], next: null, first_seq: "x" })).fetch }).pull("ws1", 5)).rejects.toThrow();
  });
});

/** An in-memory stand-in for expo-sqlite's database, enough for the cache's three statements. */
function fakeDb() {
  const rows = new Map<string, Uint8Array>();
  const execs: string[] = [];
  const db: CacheDb = {
    execAsync: jest.fn(async (sql: string) => { execs.push(sql); }),
    getFirstAsync: jest.fn(async (sql: string, ...p: unknown[]) => {
      if (sql.includes("COUNT(*)")) return { n: [...rows.keys()].filter((k) => k.split("\u0000")[0] === p[0]).length } as never;
      const v = rows.get(`${p[0]}\u0000${p[1]}`);
      return v ? ({ snapshot: v } as never) : null;
    }),
    runAsync: jest.fn(async (sql: string, ...p: unknown[]) => {
      if (sql.startsWith("INSERT OR REPLACE")) rows.set(`${p[0]}\u0000${p[1]}`, p[2] as Uint8Array);
      else if (sql.includes("AND workspace_id")) rows.delete(`${p[0]}\u0000${p[1]}`);
      else for (const k of [...rows.keys()]) if (k.split("\u0000")[0] === p[0]) rows.delete(k);
      return { changes: 1, lastInsertRowId: 0 } as never;
    }),
  };
  return { db, rows, execs };
}

describe("sqliteLocalCache", () => {
  it("round-trips sealed snapshots per user and workspace in personas_cache and clears by user or workspace", async () => {
    const { db, execs } = fakeDb();
    const open = jest.fn(async () => db);
    const cache = sqliteLocalCache(open);
    expect(await cache.load("u1", "w1")).toBeNull();
    await cache.save("u1", "w1", new Uint8Array([1]));
    await cache.save("u1", "w2", new Uint8Array([2]));
    await cache.save("u10", "w1", new Uint8Array([3]));
    expect(Array.from((await cache.load("u1", "w1"))!)).toEqual([1]);
    await cache.clear("u1", "w2");
    expect(await cache.load("u1", "w2")).toBeNull();
    expect(await cache.load("u1", "w1")).not.toBeNull();
    await cache.clear("u1");
    expect(await cache.load("u1", "w1")).toBeNull();
    expect(await cache.load("u10", "w1")).not.toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(execs.join("\n")).toMatch(/CREATE TABLE IF NOT EXISTS personas_cache \(\s*user_id TEXT NOT NULL,\s*workspace_id TEXT NOT NULL,\s*snapshot BLOB NOT NULL/);
  });

  it("hands back a copy, so the engine cannot change what is stored", async () => {
    const { db } = fakeDb();
    const cache = sqliteLocalCache(async () => db);
    const sealed = new Uint8Array([5, 6]);
    await cache.save("u1", "w1", sealed);
    sealed[0] = 0;
    const got = (await cache.load("u1", "w1"))!;
    got[1] = 0;
    expect(Array.from((await cache.load("u1", "w1"))!)).toEqual([5, 6]);
  });
});

describe("sqliteHasSnapshots", () => {
  it("is true while the user has any snapshot row", async () => {
    const { db } = fakeDb();
    const cache = sqliteLocalCache(async () => db);
    expect(await sqliteHasSnapshots(async () => db, "u1")).toBe(false);
    await cache.save("u1", "w1", new Uint8Array([1]));
    expect(await sqliteHasSnapshots(async () => db, "u1")).toBe(true);
    expect(await sqliteHasSnapshots(async () => db, "u2")).toBe(false);
    await cache.clear("u1");
    expect(await sqliteHasSnapshots(async () => db, "u1")).toBe(false);
  });
});

describe("secureKeyStore", () => {
  function fakeStore(): SecretStore & { items: Map<string, string> } {
    const items = new Map<string, string>();
    return {
      items,
      getItemAsync: jest.fn(async (k: string) => items.get(k) ?? null),
      setItemAsync: jest.fn(async (k: string, v: string) => { items.set(k, v); }),
      deleteItemAsync: jest.fn(async (k: string) => { items.delete(k); }),
    };
  }

  it("keeps the record base64 under personas_key_v2_<userId>, per user", async () => {
    const s = fakeStore();
    const keys = secureKeyStore(s);
    expect(await keys.get("u1")).toBeNull();
    await keys.set("u1", new Uint8Array([1, 2, 3]));
    await keys.set("u2", new Uint8Array([9]));
    expect([...s.items.keys()].sort()).toEqual(["personas_key_v2_u1", "personas_key_v2_u2"]);
    expect(s.items.get("personas_key_v2_u1")).toBe("AQID");
    expect(Array.from((await keys.get("u1"))!)).toEqual([1, 2, 3]);
    await keys.clear("u1");
    expect(await keys.get("u1")).toBeNull();
    expect(await keys.get("u2")).not.toBeNull();
  });

  it("reads v2", async () => {
    const s = fakeStore();
    s.items.set("personas_key_v2_u1", "AQID");
    expect(Array.from((await secureKeyStore(s).get("u1"))!)).toEqual([1, 2, 3]);
    expect(s.getItemAsync).toHaveBeenCalledTimes(1);
  });

  it("migrates v1 to v2 and deletes v1", async () => {
    const s = fakeStore();
    s.items.set("personas_key_u1", "AQID");
    expect(Array.from((await secureKeyStore(s).get("u1"))!)).toEqual([1, 2, 3]);
    expect(s.items.get("personas_key_v2_u1")).toBe("AQID");
    expect(s.items.has("personas_key_u1")).toBe(false);
  });

  it("a failed v2 write keeps v1 and still returns the key", async () => {
    const s = fakeStore();
    s.items.set("personas_key_u1", "AQID");
    s.setItemAsync = jest.fn(async () => { throw new Error("keychain"); });
    expect(Array.from((await secureKeyStore(s).get("u1"))!)).toEqual([1, 2, 3]);
    expect(s.items.get("personas_key_u1")).toBe("AQID");
    expect(s.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("clear deletes both", async () => {
    const s = fakeStore();
    s.items.set("personas_key_u1", "AQID");
    s.items.set("personas_key_v2_u1", "AQID");
    await secureKeyStore(s).clear("u1");
    expect(s.items.size).toBe(0);
  });

  it("writes use AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY", async () => {
    const s = fakeStore();
    await secureKeyStore(s).set("u1", new Uint8Array([1]));
    expect(s.setItemAsync).toHaveBeenCalledWith("personas_key_v2_u1", "AQ==", { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    // the migration write too
    s.items.set("personas_key_u2", "AQID");
    await secureKeyStore(s).get("u2");
    expect(s.setItemAsync).toHaveBeenLastCalledWith("personas_key_v2_u2", "AQID", { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  });

  it("a user id with characters the store refuses still gets its own key name", async () => {
    const s = fakeStore();
    await secureKeyStore(s).set("a@b:c", new Uint8Array([1]));
    expect([...s.items.keys()][0]).toMatch(/^personas_key_v2_[A-Za-z0-9._-]+$/);
    expect(await secureKeyStore(s).get("a_b_c")).toBeNull();
  });

  it("an unreadable store reads as no key (the unlock gate), never a crash", async () => {
    const s = fakeStore();
    s.getItemAsync = jest.fn(async () => { throw new Error("keychain"); });
    expect(await secureKeyStore(s).get("u1")).toBeNull();
  });
});

describe("mobileFileSource", () => {
  const tree = {
    ok: true,
    folders: [
      { id: "fa", name: "A", parent_id: null, is_hidden: 0, lock_mode: "none" },
      { id: "fb", name: "B", parent_id: "fa", is_hidden: 0, lock_mode: "none" },
    ],
  };
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: `${id}.jpg`, folder_id: null, current_version: 1, taken_at: 100, is_hidden: 0, lock_mode: "none", ...extra,
  });

  function server(pages: unknown[][], opts: { failPage?: number; treeBody?: unknown } = {}) {
    return fetchMock((url) => {
      const u = new URL(url);
      if (u.pathname === "/api/folders/tree") {
        if (u.searchParams.get("flags") !== "1") return res({ ok: true, folders: [] });
        return res(opts.treeBody ?? tree);
      }
      if (u.pathname === "/api/library") {
        const cursor = u.searchParams.get("cursor");
        const i = cursor ? Number(cursor) : 0;
        if (opts.failPage === i) return res({ ok: false, error: "boom" }, 500);
        return res({ ok: true, months: [{ key: "2026-10", files: pages[i] }], next_cursor: i + 1 < pages.length ? String(i + 1) : null });
      }
      return res({}, 404);
    });
  }

  async function all(src: ReturnType<typeof mobileFileSource>, ws = "ws1"): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for await (const c of src.candidates(ws)) out.push(c);
    return out;
  }

  it("lists every photo of the workspace with its version, date and folder ancestry, with the bearer token", async () => {
    const m = server([
      [row("p1", { folder_id: "fb", current_version: 3, taken_at: 500 }), row("p2")],
      [row("p3", { folder_id: "fa", current_version: null })],
    ]);
    expect(await all(mobileFileSource({ ...auth, fetch: m.fetch }))).toEqual([
      { file: "p1", ver: 3, folder: "fb", ancestors: ["fa"], sortAt: 500 },
      { file: "p2", ver: 1, folder: null, ancestors: [], sortAt: 100 },
      { file: "p3", ver: 1, folder: "fa", ancestors: [], sortAt: 100 },
    ]);
    const lib = m.calls.filter((c) => c.url.includes("/api/library")).map((c) => new URL(c.url));
    expect(lib[0].searchParams.get("workspace_id")).toBe("ws1");
    expect(lib[0].searchParams.get("kind")).toBe("photos");
    expect(lib[1].searchParams.get("cursor")).toBe("1");
    expect(m.calls.filter((c) => c.url.includes("/api/folders/tree"))).toHaveLength(1);
    expect(m.calls.every((c) => header(c, "Authorization") === "Bearer tok")).toBe(true);
  });

  it("gives the listed photos' rows by id from the same cached listing", async () => {
    const m = server([[row("ok", { folder_id: "fa", mime_type: "image/jpeg" }), row("hidden", { is_hidden: 1 })]]);
    const src = mobileFileSource({ ...auth, fetch: m.fetch });
    const rows = await src.photos("ws1");
    expect([...rows.keys()]).toEqual(["ok"]);
    await all(src);
    expect(await src.photos("ws1")).toBe(rows);
    expect(m.calls.filter((c) => c.url.includes("/api/library"))).toHaveLength(1);
  });

  it("leaves out hidden and locked files and anything under a hidden or locked folder, or a folder it cannot see", async () => {
    const m = server([[
      row("ok"),
      row("hidden", { is_hidden: 1 }),
      row("locked", { lock_mode: "full_lock" }),
      row("viewonly", { lock_mode: "view_only" }),
      row("unknownFolder", { folder_id: "gone" }),
      row("lockedFolder", { folder_id: "fl" }),
      row("hiddenFolder", { folder_id: "fh2" }),
    ]], {
      treeBody: {
        ok: true,
        folders: [
          { id: "fl", parent_id: null, is_hidden: 0, lock_mode: "full_lock" },
          { id: "fh", parent_id: null, is_hidden: 1, lock_mode: "none" },
          { id: "fh2", parent_id: "fh", is_hidden: 0, lock_mode: "none" },
        ],
      },
    });
    expect((await all(mobileFileSource({ ...auth, fetch: m.fetch }))).map((c) => c.file)).toEqual(["ok"]);
  });

  it("a folder-confined member: ancestry stops at the anchor; an anchor under a hidden or locked folder fails closed", async () => {
    const open = server([[row("p1", { folder_id: "sub" }), row("p2", { folder_id: "anchor" })]], {
      treeBody: { ok: true, folders: [{ id: "anchor", parent_id: "outside", is_hidden: 0, lock_mode: "none", inherited_hidden: 0, inherited_lock: 0 }, { id: "sub", parent_id: "anchor", is_hidden: 0, lock_mode: "none" }] },
    });
    expect(await all(mobileFileSource({ ...auth, fetch: open.fetch }))).toEqual([
      { file: "p1", ver: 1, folder: "sub", ancestors: ["anchor"], sortAt: 100 },
      { file: "p2", ver: 1, folder: "anchor", ancestors: [], sortAt: 100 },
    ]);
    for (const inherited of [{ inherited_lock: 1, inherited_hidden: 0 }, { inherited_lock: 0, inherited_hidden: 1 }, {}]) {
      const m = server([[row("p1", { folder_id: "sub" }), row("p2", { folder_id: "anchor" })]], {
        treeBody: { ok: true, folders: [{ id: "anchor", parent_id: "outside", is_hidden: 0, lock_mode: "none", ...inherited }, { id: "sub", parent_id: "anchor", is_hidden: 0, lock_mode: "none" }] },
      });
      expect(await all(mobileFileSource({ ...auth, fetch: m.fetch }))).toEqual([]);
    }
  });

  it("throws on any listing error instead of listing nothing, and does not cache it", async () => {
    const pages = [[row("p1")], [row("p2")]];
    await expect(all(mobileFileSource({ ...auth, fetch: server(pages, { failPage: 1 }).fetch }))).rejects.toBeInstanceOf(PersonasHttpError);
    await expect(all(mobileFileSource({ ...auth, fetch: server(pages, { treeBody: { ok: false } }).fetch }))).rejects.toThrow();
    await expect(all(mobileFileSource({ ...auth, fetch: server(pages, { treeBody: { ok: true, folders: [{ id: "fa", parent_id: null }] } }).fetch }))).rejects.toThrow();
    const offline = mobileFileSource({ ...auth, fetch: (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch });
    await expect(all(offline)).rejects.toThrow();
    let n = 0;
    const flaky = fetchMock((url) => {
      if (url.includes("/tree")) return res(tree);
      return n++ === 0 ? res({ ok: false }, 500) : res({ ok: true, months: [{ files: [row("p1")] }], next_cursor: null });
    });
    const src = mobileFileSource({ ...auth, fetch: flaky.fetch });
    await expect(all(src)).rejects.toThrow();
    expect((await all(src)).map((c) => c.file)).toEqual(["p1"]);
  });

  it("keeps the full listing for five minutes per workspace", async () => {
    let t = 1_000_000;
    const m = server([[row("p1")]]);
    const src = mobileFileSource({ ...auth, fetch: m.fetch, now: () => t });
    await all(src);
    const n = m.calls.length;
    t += 4 * 60_000;
    await all(src);
    expect(m.calls.length).toBe(n);
    await all(src, "ws2");
    expect(m.calls.length).toBe(2 * n);
    t += 61_000;
    await all(src);
    expect(m.calls.length).toBe(3 * n);
  });

  it("rendition: the 1600 px rendition of that version; a non-JPEG/WebP or oversized answer is unsupported", async () => {
    const m = fetchMock((url) =>
      url.includes("/f1/") ? res(new Uint8Array([9, 9]), 200, { "Content-Type": "image/webp" })
        : url.includes("/f2/") ? res("<svg/>", 200, { "Content-Type": "image/svg+xml" })
          : url.includes("/big/") ? res(new Uint8Array(4), 200, { "Content-Type": "image/jpeg", "Content-Length": String(64 * 1024 * 1024) })
            : res({ ok: false }, 404),
    );
    const src = mobileFileSource({ ...auth, fetch: m.fetch });
    expect(Array.from(await src.rendition("f1", 3))).toEqual([9, 9]);
    expect(m.calls[0].url).toBe("https://api.test/api/files/f1/thumb?w=1600&version=3");
    expect(header(m.calls[0], "Authorization")).toBe("Bearer tok");
    await expect(src.rendition("f2", 1)).rejects.toBeInstanceOf(ReaderUnsupportedError);
    await expect(src.rendition("big", 1)).rejects.toBeInstanceOf(ReaderUnsupportedError);
  });

  it("rendition: network errors and 401/403/408/429/5xx are unavailable (not the photo's fault); 404 and 415 are the photo's", async () => {
    const offline = mobileFileSource({ ...auth, fetch: (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch });
    await expect(offline.rendition("f1", 1)).rejects.toBeInstanceOf(PersonasUnavailableError);
    for (const status of [401, 403, 408, 429, 500, 502, 503]) {
      const src = mobileFileSource({ ...auth, fetch: fetchMock(() => res({ ok: false }, status)).fetch });
      const err = await src.rendition("f1", 1).catch((e) => e);
      expect([status, err instanceof PersonasUnavailableError]).toEqual([status, true]);
    }
    for (const status of [404, 415]) {
      const src = mobileFileSource({ ...auth, fetch: fetchMock(() => res({ ok: false }, status)).fetch });
      const err = await src.rendition("f1", 1).catch((e) => e);
      expect(err).not.toBeInstanceOf(PersonasUnavailableError);
      expect(err.status).toBe(status);
    }
    const broken = mobileFileSource({ ...auth, fetch: fetchMock(() => ({ ...res(new Uint8Array(1), 200, { "Content-Type": "image/jpeg" }), arrayBuffer: async () => { throw new Error("cut"); } })).fetch });
    await expect(broken.rendition("f1", 1)).rejects.toBeInstanceOf(PersonasUnavailableError);
  });
});

describe("request time limits", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a rendition that never answers fails as unavailable after 60 s, and the request was given the signal", async () => {
    const m = fetchMock(() => new Promise<FakeRes>(() => undefined));
    const src = mobileFileSource({ ...auth, fetch: m.fetch });
    let err: unknown = null;
    const p = src.rendition("f1", 1).catch((e) => (err = e));
    await jest.advanceTimersByTimeAsync(59_000);
    expect(err).toBeNull();
    await jest.advanceTimersByTimeAsync(1_500);
    await p;
    expect(err).toBeInstanceOf(PersonasUnavailableError);
    expect((m.calls[0].init.signal as AbortSignal).aborted).toBe(true);
  });

  it("a rendition body that never ends fails as unavailable too", async () => {
    const m = fetchMock(() => ({ ...res(new Uint8Array(1), 200, { "Content-Type": "image/jpeg" }), arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined) }));
    const src = mobileFileSource({ ...auth, fetch: m.fetch });
    let err: unknown = null;
    const p = src.rendition("f1", 1).catch((e) => (err = e));
    await jest.advanceTimersByTimeAsync(61_000);
    await p;
    expect(err).toBeInstanceOf(PersonasUnavailableError);
  });

  it("the caller's abort ends a rendition at once, and is not reported as unavailable", async () => {
    const m = fetchMock(() => new Promise<FakeRes>(() => undefined));
    const src = mobileFileSource({ ...auth, fetch: m.fetch });
    const ac = new AbortController();
    let err: unknown = null;
    const p = src.rendition("f1", 1, ac.signal).catch((e) => (err = e));
    await jest.advanceTimersByTimeAsync(10);
    ac.abort();
    await jest.advanceTimersByTimeAsync(0);
    await p;
    expect(err).not.toBeNull();
    expect(err).not.toBeInstanceOf(PersonasUnavailableError);
    expect((m.calls[0].init.signal as AbortSignal).aborted).toBe(true);
  });

  it("a listing request that never answers fails after its limit", async () => {
    const m = fetchMock(() => new Promise<FakeRes>(() => undefined));
    const src = mobileFileSource({ ...auth, fetch: m.fetch, timeoutMs: 1_000 });
    let err: unknown = null;
    const p = src.photos("ws1").catch((e) => (err = e));
    await jest.advanceTimersByTimeAsync(1_100);
    await p;
    expect((err as Error)?.name).toBe("PersonasTimeoutError");
  });
});
