import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";

const mockDisk = new Map<string, string>();
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  readAsStringAsync: jest.fn(async (p: string) => {
    if (!mockDisk.has(p)) throw new Error("ENOENT");
    return mockDisk.get(p) as string;
  }),
  writeAsStringAsync: jest.fn(async (p: string, v: string) => { mockDisk.set(p, v); }),
  deleteAsync: jest.fn(async (p: string) => { mockDisk.delete(p); }),
}));
const mockGetFile = jest.fn();
jest.mock("@/files/api", () => ({ getFile: (...a: unknown[]) => mockGetFile(...a) }));
// The signed-in account, which stamps the file and gates reading it back.
const mockLoadUser = jest.fn();
jest.mock("@/auth/tokenStore", () => ({ loadUser: () => mockLoadUser() }));

import { QUERY_CACHE_FILE, persistQueryCache, restoreQueryCache, clearPersistedQueryCache, startQueryPersistence, __setMaxCacheBytesForTests } from "./queryPersist";
import { useFile } from "@/files/hooks";
import { AppState } from "react-native";

const FILE = { id: "f1", name: "notes.txt", size_bytes: 12, mime_type: "text/plain", extension: ".txt", created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0 };

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity}, mutations: { gcTime: 0 } } });

const ME = { id: "user-a", email: "a@x.com", name: "A" };

beforeEach(() => {
  mockDisk.clear();
  mockGetFile.mockReset();
  mockLoadUser.mockReset().mockResolvedValue(ME);
});

describe("query cache persistence", () => {
  it("round-trips successful queries through the document directory", async () => {
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    a.setQueryData(["workspaces"], [{ id: "w1" }]);
    a.setQueryData(["search", "w1", "x"], [{ id: "hit" }]); // not persisted: transient by nature
    await persistQueryCache(a);
    expect(mockDisk.has(QUERY_CACHE_FILE)).toBe(true);

    const b = client();
    await expect(restoreQueryCache(b)).resolves.toBe(true);
    expect(b.getQueryData(["file", "f1"])).toEqual(FILE);
    expect(b.getQueryData(["workspaces"])).toEqual([{ id: "w1" }]);
    expect(b.getQueryData(["search", "w1", "x"])).toBeUndefined();
  });

  it("lets useFile resolve from the restored cache when the network fails (offline cold start)", async () => {
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    await persistQueryCache(a);

    const b = client();
    await restoreQueryCache(b);
    mockGetFile.mockRejectedValue(new Error("Network request failed"));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={b}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useFile("f1"), { wrapper });

    // Cached data is there on the first render, before any request settles.
    expect(result.current.data).toEqual(FILE);
    // The background refetch fails; the data stays.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual(FILE);
  });

  it("ignores a missing, corrupt, foreign or stale file", async () => {
    await expect(restoreQueryCache(client())).resolves.toBe(false);
    mockDisk.set(QUERY_CACHE_FILE, "{nope");
    await expect(restoreQueryCache(client())).resolves.toBe(false);
    mockDisk.set(QUERY_CACHE_FILE, JSON.stringify({ v: 99, savedAt: Date.now(), account: ME.id, state: { queries: [], mutations: [] } }));
    await expect(restoreQueryCache(client())).resolves.toBe(false);
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    await persistQueryCache(a);
    const saved = JSON.parse(mockDisk.get(QUERY_CACHE_FILE) as string);
    saved.savedAt = Date.now() - 8 * 24 * 3600 * 1000;
    mockDisk.set(QUERY_CACHE_FILE, JSON.stringify(saved));
    const b = client();
    await expect(restoreQueryCache(b)).resolves.toBe(false);
    expect(b.getQueryData(["file", "f1"])).toBeUndefined();
  });

  it("refuses a file another account left behind", async () => {
    // The account-switch purge deletes this file, but it is asynchronous and
    // the app can be killed part-way through one. Without the stamp, the next
    // launch restored the PREVIOUS account's `me` and `workspaces` - another
    // user's name and storage, on screen, before any request went out.
    const a = client();
    a.setQueryData(["me"], ME);
    a.setQueryData(["workspaces"], [{ id: "w-of-a" }]);
    await persistQueryCache(a);

    mockLoadUser.mockResolvedValue({ id: "user-b", email: "b@x.com", name: "B" });
    const b = client();
    await expect(restoreQueryCache(b)).resolves.toBe(false);
    expect(b.getQueryData(["me"])).toBeUndefined();
    expect(b.getQueryData(["workspaces"])).toBeUndefined();
  });

  it("refuses it when it cannot tell whose account this is", async () => {
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    await persistQueryCache(a);
    // Signed out, or a keychain that would not open: fail closed. The cost is
    // one cold start without the offline cache; the alternative is guessing.
    mockLoadUser.mockRejectedValue(new Error("keychain locked"));
    await expect(restoreQueryCache(client())).resolves.toBe(false);
    mockLoadUser.mockResolvedValue(null);
    await expect(restoreQueryCache(client())).resolves.toBe(false);
  });

  it("writes nothing while signed out - a file with no owner can never be handed back", async () => {
    mockLoadUser.mockResolvedValue(null);
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    await persistQueryCache(a);
    expect(mockDisk.has(QUERY_CACHE_FILE)).toBe(false);
  });

  it("writes when the app goes to the background, and stops when disposed", async () => {
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    const listeners: Array<(s: string) => void> = [];
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (s: string) => void) => {
      listeners.push(cb);
      return { remove: () => { listeners.length = 0; } };
    }) as never);
    try {
      const stop = startQueryPersistence(a);
      listeners.forEach((cb) => cb("background"));
      await waitFor(() => expect(mockDisk.has(QUERY_CACHE_FILE)).toBe(true));
      stop();
      expect(listeners).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("applies the whitelist on the way IN as well - a file naming other roots restores only what we trust", async () => {
    // Hand-written file (an older build, a tampered one): everything in it
    // claims to be cache, but only the whitelisted roots may be believed.
    const forged = {
      v: 2,
      savedAt: Date.now(),
      account: ME.id,
      state: {
        mutations: [],
        queries: [
          { queryKey: ["file", "f1"], queryHash: JSON.stringify(["file", "f1"]), state: { data: FILE, dataUpdatedAt: Date.now(), status: "success", fetchStatus: "idle" } },
          { queryKey: ["search", "w1", "x"], queryHash: JSON.stringify(["search", "w1", "x"]), state: { data: [{ id: "hit" }], dataUpdatedAt: Date.now(), status: "success", fetchStatus: "idle" } },
          { queryKey: ["admin-users"], queryHash: JSON.stringify(["admin-users"]), state: { data: [{ id: "u" }], dataUpdatedAt: Date.now(), status: "success", fetchStatus: "idle" } },
        ],
      },
    };
    mockDisk.set(QUERY_CACHE_FILE, JSON.stringify(forged));
    const c = client();
    await expect(restoreQueryCache(c)).resolves.toBe(true);
    expect(c.getQueryData(["file", "f1"])).toEqual(FILE);
    expect(c.getQueryData(["search", "w1", "x"])).toBeUndefined();
    expect(c.getQueryData(["admin-users"])).toBeUndefined();
  });

  it("ignores a file that has grown past the cap rather than parsing it at launch", async () => {
    __setMaxCacheBytesForTests(500);
    try {
      const a = client();
      a.setQueryData(["file", "f1"], { ...FILE, blob: "x".repeat(5000) });
      await persistQueryCache(a);
      // Nothing (or a trimmed file) was written; either way a bloated file is
      // never parsed back in.
      const raw = mockDisk.get(QUERY_CACHE_FILE);
      if (raw) expect(raw.length).toBeLessThanOrEqual(500);
      mockDisk.set(QUERY_CACHE_FILE, JSON.stringify({ v: 2, savedAt: Date.now(), account: ME.id, state: { queries: [], mutations: [], pad: "y".repeat(2000) } }));
      await expect(restoreQueryCache(client())).resolves.toBe(false);
    } finally {
      __setMaxCacheBytesForTests(null);
    }
  });

  it("trims the oldest entries instead of writing an unbounded file", async () => {
    const big = (n: number) => ({ ...FILE, blob: "x".repeat(400), n });
    // Measure one entry's real cost, then allow a cap that fits exactly one.
    const probe = client();
    probe.setQueryData(["file", "new"], big(2));
    await persistQueryCache(probe);
    const oneEntry = (mockDisk.get(QUERY_CACHE_FILE) as string).length;
    mockDisk.clear();

    __setMaxCacheBytesForTests(oneEntry + 20);
    try {
      const a = client();
      // Explicit ages: "newest wins" is the rule being tested, and two
      // setQueryData calls in the same millisecond would not express it.
      a.setQueryData(["file", "old"], big(1), { updatedAt: Date.now() - 60_000 });
      a.setQueryData(["file", "new"], big(2), { updatedAt: Date.now() });
      await persistQueryCache(a);
      const raw = mockDisk.get(QUERY_CACHE_FILE);
      expect(raw && raw.length).toBeLessThanOrEqual(oneEntry + 20);
      const b = client();
      await restoreQueryCache(b);
      // The newest survived; the oldest was dropped to fit.
      expect(b.getQueryData(["file", "new"])).toBeTruthy();
      expect(b.getQueryData(["file", "old"])).toBeUndefined();
    } finally {
      __setMaxCacheBytesForTests(null);
    }
  });

  it("clears the file on purge", async () => {
    const a = client();
    a.setQueryData(["file", "f1"], FILE);
    await persistQueryCache(a);
    await clearPersistedQueryCache();
    expect(mockDisk.has(QUERY_CACHE_FILE)).toBe(false);
  });
});
