import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFile, useFileList } from "./hooks";
import { getFile, listFiles } from "./api";
import type { FileItem } from "./types";

jest.mock("./api", () => ({ getFile: jest.fn(), listFiles: jest.fn() }));

// Offline files: a real store (SQLite on node:sqlite, an in-memory disk) so the
// local reads below are the ones the app makes. The connection state and the
// sync trigger are the seams.
jest.mock("expo-file-system/legacy", () => require("@/offline/testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("@/offline/testing/sqliteNode").sqliteModule);
const mockOnline = { value: null as boolean | null };
jest.mock("@/offline/network", () => ({ isOnlineNow: () => mockOnline.value, useIsOnline: () => mockOnline.value }));
jest.mock("@/offline/sync", () => ({ runOfflineSync: jest.fn(async () => {}) }));
const mockSecure: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));

import { ApiError } from "@/api/errors";
import { apiRequest } from "@/api/client";
import { useAuthStore, getAccessToken } from "@/auth/authStore";
import { saveTokens, saveUser, loadTokens } from "@/auth/tokenStore";
import { resetSqlite } from "@/offline/testing/sqliteNode";
import { putFile, resetFs } from "@/offline/testing/memoryFs";
import { beginSession, withCommit, __resetSessionForTests, type OfflineSession } from "@/offline/session";
import { addMembers, closeOfflineDb, publishSaved, replaceFolders, upsertMeta, upsertPin } from "@/offline/db";
import { finalPath } from "@/offline/store";
import { runOfflineSync } from "@/offline/sync";

const ROW: FileItem = {
  id: "f2", name: "c.jpg", size_bytes: 10, mime_type: "image/jpeg", extension: ".jpg",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const testClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });

beforeEach(() => {
  mockOnline.value = null;
  jest.clearAllMocks();
});

// A swipe onto a file whose record is not cached used to report isLoading,
// and the viewer swapped its whole pager for the loading skeleton until the
// record arrived - the "page refreshes" on every swipe.
it("stands the listing row in for the record while it loads", async () => {
  let resolve!: (v: unknown) => void;
  (getFile as jest.Mock).mockReturnValue(new Promise((r) => { resolve = r; }));
  const qc = testClient();
  const { result } = renderHook(() => useFile("f2", ROW), { wrapper: wrapper(qc) });

  expect(result.current.isLoading).toBe(false);
  expect(result.current.data?.name).toBe("c.jpg");

  resolve({ ...ROW, region: "apac" });
  await waitFor(() => expect(result.current.data).toEqual({ ...ROW, region: "apac" }));
});

it("never stands in a row for a different file", () => {
  (getFile as jest.Mock).mockReturnValue(new Promise(() => {}));
  const qc = testClient();
  const { result } = renderHook(() => useFile("f9", ROW), { wrapper: wrapper(qc) });
  expect(result.current.data).toBeUndefined();
});

describe("offline files", () => {
  let s: OfflineSession;

  beforeEach(async () => {
    __resetSessionForTests();
    await closeOfflineDb();
    resetSqlite();
    resetFs();
    s = beginSession("acct");
    await withCommit(s, async () => {
      await upsertPin(s, { id: "P", kind: "folder", workspace_id: "w1", name: "Pinned", created_at: 1 });
      await replaceFolders(s, "P", [{ id: "P", workspace_id: "w1", parent_id: null, name: "Pinned", pin_id: "P" }]);
      await upsertMeta(s, [{
        file_id: "a", workspace_id: "w1", folder_id: "P", name: "a.pdf", extension: "pdf", mime_type: "application/pdf",
        size_bytes: 10, current_version: 3, updated_at: 1, lock_mode: "none",
      }]);
      await addMembers(s, "P", ["a"]);
      await publishSaved(s, "a", { version: 3, size: 10, rendition: "none", renditionSize: null });
      putFile(finalPath(s, "a", 3, "pdf"), 10);
    });
  });

  it("offline: useFile and useFileList resolve locally without calling the API", async () => {
    mockOnline.value = false;
    const qc = testClient();
    const file = renderHook(() => useFile("a"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(file.result.current.data).toMatchObject({ id: "a", name: "a.pdf", current_version: 3 }));
    const list = renderHook(() => useFileList("w1", "P", "all", "newest"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(list.result.current.data?.pages[0].files.map((f) => f.id)).toEqual(["a"]));
    expect(list.result.current.data?.pages[0].breadcrumbs).toEqual([{ id: "P", name: "Pinned" }]);
    expect(getFile).not.toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("unpinned folder offline errors at once (no pause)", async () => {
    mockOnline.value = false;
    // The app's own client retries twice; offline must not wait out that backoff.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 2, gcTime: 0 } } });
    const { result } = renderHook(() => useFileList("w1", "elsewhere", "all", "newest"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 300 });
    expect(result.current.fetchStatus).toBe("idle");
    expect((result.current.error as ApiError).status).toBe(0);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("online, a network failure falls back to the saved record", async () => {
    mockOnline.value = null;
    (getFile as jest.Mock).mockRejectedValue(new ApiError("Network request failed", 0));
    const qc = testClient();
    const { result } = renderHook(() => useFile("a"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.id).toBe("a"));
    expect(getFile).toHaveBeenCalled();
  });

  it("online 403 for a saved file: not shown, sync requested", async () => {
    mockOnline.value = true;
    (getFile as jest.Mock).mockRejectedValue(new ApiError("Forbidden", 403));
    const qc = testClient();
    const { result } = renderHook(() => useFile("a"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect((result.current.error as ApiError).status).toBe(403);
    expect(runOfflineSync).toHaveBeenCalledWith({ reason: "manual" });
  });

  describe("cold start offline with an expired access token", () => {
    const USER = { id: "acct", email: "a@b.com", name: "A", created_at: 1 };
    const realFetch = global.fetch;

    beforeEach(async () => {
      for (const k of Object.keys(mockSecure)) delete mockSecure[k];
      await saveTokens({ access: "dosm_expired", refresh: "dosr_live" });
      await saveUser(USER);
      useAuthStore.setState({ status: "loading", user: null, pending2fa: null, error: null });
      // The files API goes through the real client, as on a device.
      (getFile as jest.Mock).mockImplementation(async (id: string) => (await apiRequest<{ file: unknown }>(`/api/files/${id}`)).file);
    });
    afterEach(() => { global.fetch = realFetch; });

    it.each([
      ["airplane mode: every request fails", () => jest.fn(async () => { throw new TypeError("Network request failed"); })],
      ["a 401 whose refresh cannot reach the server", () => jest.fn(async (url: string) => {
        if (String(url).includes("/api/auth/")) throw new TypeError("Network request failed");
        return new Response(JSON.stringify({ ok: false, error: "expired" }), { status: 401 });
      })],
    ])("cold start offline with an expired access token: local read is not blocked and the user stays signed in (%s)", async (_l, makeFetch) => {
      global.fetch = makeFetch() as unknown as typeof fetch;
      await useAuthStore.getState().hydrate();
      expect(useAuthStore.getState()).toMatchObject({ status: "signedIn", user: USER });

      const qc = testClient();
      const { result } = renderHook(() => useFile("a"), { wrapper: wrapper(qc) });
      await waitFor(() => expect(result.current.data).toMatchObject({ id: "a", current_version: 3 }));

      expect(useAuthStore.getState().status).toBe("signedIn");
      expect(await loadTokens()).toEqual({ access: "dosm_expired", refresh: "dosr_live" });
      expect(getAccessToken()).toBe("dosm_expired");
    });
  });
});
