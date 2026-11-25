import { act, renderHook, waitFor } from "@testing-library/react-native";
import { MAX_INLINE_TEXT_BYTES, STREAM_URL_TTL_SECONDS, useFilePreview } from "./useFilePreview";
import { getDownloadUrl } from "@/files/api";
import type { FileDetail } from "@/files/types";

jest.mock("@/files/api", () => ({ getDownloadUrl: jest.fn() }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok_live" }));
jest.mock("@/api", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/files/byteStore", () => ({
  localUri: jest.fn(async () => null),
  ensureLocal: jest.fn(async () => null),
}));
// Offline files: the saved copy and the connection are the seams; chooseSource
// is the real one. db and sync are auto-mocked so a test can prove the viewer
// never writes to the offline store.
jest.mock("@/offline/read", () => ({ ...jest.requireActual("@/offline/read"), savedCopy: jest.fn(async () => null) }));
const mockOnline = { value: null as boolean | null };
jest.mock("@/offline/network", () => ({ useIsOnline: () => mockOnline.value, isOnlineNow: () => mockOnline.value }));
jest.mock("@/offline/db");
jest.mock("@/offline/sync");
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  readAsStringAsync: jest.fn(async () => "saved text"),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1 })),
}));

const mockGet = getDownloadUrl as jest.MockedFunction<typeof getDownloadUrl>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require("@/files/byteStore") as {
  localUri: jest.Mock;
  ensureLocal: jest.Mock;
};

function makeFile(over: Partial<FileDetail> = {}): FileDetail {
  return {
    id: "f1",
    name: "notes.txt",
    size_bytes: 400,
    mime_type: "text/plain",
    extension: ".txt",
    created_at: 1,
    updated_at: 1,
    current_version: 3,
    lock_mode: "none",
    share_count: 0,
    comment_count: 0,
    ...over,
  };
}

describe("useFilePreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue("https://r2.test/presigned");
    store.localUri.mockResolvedValue(null);
    store.ensureLocal.mockResolvedValue(null);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "hello world" })) as never;
  });

  it("presigns an ordinary file and reads its text body", async () => {
    const { result } = renderHook(() => useFilePreview(makeFile(), null));
    await waitFor(() => expect(result.current.text).toBe("hello world"));
    expect(result.current.uri).toBe("https://r2.test/presigned");
    expect(result.current.headers).toBeUndefined();
    expect(result.current.failed).toBe(false);
  });

  // download-url 403s a view-only file before it presigns, so presigning is
  // not a fallback here - it is a guaranteed failure.
  it("never presigns a view-only file, and carries the bearer instead", async () => {
    const { result } = renderHook(() => useFilePreview(makeFile({ lock_mode: "view_only" }), null));
    await waitFor(() => expect(result.current.uri).toContain("/api/files/f1/raw"));
    expect(result.current.uri).toContain("version=3");
    expect(result.current.headers).toEqual({ Authorization: "Bearer tok_live" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("asks for nothing at all while a locked file is still gated", async () => {
    const { result } = renderHook(() => useFilePreview(makeFile({ lock_mode: "full_lock" }), null));
    await waitFor(() => expect(result.current.uri).toBeNull());
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("presigns with the unlock token once the password lands", async () => {
    const { rerender } = renderHook(
      ({ token }: { token: string | null }) => useFilePreview(makeFile({ lock_mode: "full_lock" }), token),
      { initialProps: { token: null as string | null } },
    );
    expect(mockGet).not.toHaveBeenCalled();
    rerender({ token: "ut_abc" });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("f1", "ut_abc", undefined));
  });

  // The old screen swallowed this with `.catch(() => {})`, leaving a spinner
  // running forever with no way to tell a slow file from a dead one.
  it("reports a failed presign instead of spinning forever", async () => {
    mockGet.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useFilePreview(makeFile(), null));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.uri).toBeNull();
  });

  it("retries the step that failed", async () => {
    mockGet.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useFilePreview(makeFile(), null));
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
    expect(result.current.failed).toBe(false);
  });

  // downloadAsync and fetch both resolve happily for a 403, and the body is an
  // error envelope. Rendering it would show the user `{"ok":false,...}`.
  it("treats an error status as a failure, not as file content", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, text: async () => '{"ok":false}' })) as never;
    const { result } = renderHook(() => useFilePreview(makeFile(), null));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.text).toBeNull();
  });

  it("skips the body fetch above the inline cap and says why", async () => {
    const { result } = renderHook(() =>
      useFilePreview(makeFile({ size_bytes: MAX_INLINE_TEXT_BYTES + 1 }), null),
    );
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
    expect(result.current.textTooLarge).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // The bug this covers: a 512MB video stopped playing about five minutes in.
  // AVPlayer and ExoPlayer keep issuing Range requests across the whole file,
  // and the presign default is 300s, so every request after the fifth minute
  // came back 403. A short clip finishes buffering inside the window, which is
  // exactly why only big files failed. The audio player already passes a TTL
  // for the same reason; the video stage never got the same argument.
  it("presigns a video with a streaming ttl, since the player keeps requesting ranges for minutes", async () => {
    renderHook(() =>
      useFilePreview(
        makeFile({ name: "match.mp4", mime_type: "video/mp4", extension: ".mp4", size_bytes: 512 * 1024 * 1024 }),
        null,
      ),
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("f1", undefined, STREAM_URL_TTL_SECONDS));
  });

  it("presigns inline audio with the same streaming ttl, for the same reason", async () => {
    renderHook(() =>
      useFilePreview(makeFile({ name: "set.mp3", mime_type: "audio/mpeg", extension: ".mp3" }), null),
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("f1", undefined, STREAM_URL_TTL_SECONDS));
  });

  // A long-lived URL is a wider window for a leaked link, so it is spent only
  // where a player genuinely needs one.
  it("leaves a file that is read in one go on the short default ttl", async () => {
    renderHook(() => useFilePreview(makeFile({ mime_type: "image/jpeg", extension: ".jpg" }), null));
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    // No TTL requested at all, so the server applies DEFAULT_DOWNLOAD_TTL.
    expect(mockGet.mock.calls[0][2]).toBeUndefined();
  });

  it("caps the streaming ttl at the server's MAX_DOWNLOAD_TTL", () => {
    expect(STREAM_URL_TTL_SECONDS).toBe(3600);
  });

  it("does not fetch a body for a non-text file", async () => {
    const { result } = renderHook(() =>
      useFilePreview(makeFile({ mime_type: "image/jpeg", extension: ".jpg" }), null),
    );
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.textTooLarge).toBe(false);
  });

  // In a pager the filename changes the instant you swipe. Keeping the old URL
  // would render the previous file's bytes under the new file's name.
  it("drops the resolved bytes the moment the file changes", async () => {
    const { result, rerender } = renderHook(({ f }: { f: FileDetail }) => useFilePreview(f, null), {
      initialProps: { f: makeFile() },
    });
    await waitFor(() => expect(result.current.text).toBe("hello world"));

    mockGet.mockImplementation(() => new Promise(() => {})); // never resolves
    rerender({ f: makeFile({ id: "f2", name: "other.txt" }) });
    expect(result.current.uri).toBeNull();
    expect(result.current.text).toBeNull();
  });
});

describe("useFilePreview, reading from the device", () => {
  const doc = (over: Partial<FileDetail> = {}) =>
    makeFile({ name: "deck.pdf", mime_type: "application/pdf", extension: ".pdf", ...over });
  const docx = () =>
    makeFile({
      name: "report.docx",
      extension: ".docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue("https://r2.test/presigned");
    store.localUri.mockResolvedValue(null);
    store.ensureLocal.mockResolvedValue(null);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as never;
  });

  it("reads a held document from disk instead of the server", async () => {
    store.localUri.mockResolvedValue("file:///cache/files/f1-v3.pdf");
    const { result } = renderHook(() => useFilePreview(doc(), null));
    await waitFor(() => expect(result.current.uri).toBe("file:///cache/files/f1-v3.pdf"));
    // A local path carries no credential; sending one would make the
    // downloader treat a file:// path as an authenticated request.
    expect(result.current.headers).toBeUndefined();
  });

  it("keeps the copy for next time while this open streams", async () => {
    const { result } = renderHook(() => useFilePreview(doc(), null));
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
    await waitFor(() => expect(store.ensureLocal).toHaveBeenCalled());
  });

  it("does not swap the URI out from under a document that is already on screen", async () => {
    // The background fill says so itself: "the stage streams as it always did,
    // and the NEXT open reads from disk". Adopting the path mid-session breaks
    // that promise and the reader with it - the stage's source changes under a
    // mounted viewer, which remounts it and throws away the scroll position and
    // page. For an office document it was worse still: OfficeStage re-polled the
    // new URI, and React Native's fetch rejects file://, so a document sitting
    // on disk turned into "Could not prepare a preview".
    // An office document, because that is where it did the most damage and
    // because it is the case where BOTH the uri and the headers change - the
    // two dependencies OfficeStage's poll is keyed on.
    store.ensureLocal.mockResolvedValue("file:///cache/files/f1-v3.pdf");
    const endpoint = "https://api.test/api/files/f1/preview-pdf";

    const { result } = renderHook(() => useFilePreview(docx(), null));
    await waitFor(() => expect(result.current.uri).toBe(endpoint));
    await waitFor(() => expect(store.ensureLocal).toHaveBeenCalled());

    // The copy is on disk now - and this open still streams from the network,
    // still authenticated.
    expect(result.current.uri).toBe(endpoint);
    expect(result.current.headers).toMatchObject({ Authorization: "Bearer tok_live" });
  });

  it("keeps the converted PDF under its own key, not the docx's", async () => {
    // Both are "file f1, version 3". Without the variant the rendition and the
    // original overwrite each other, and one viewer gets bytes it cannot read.
    renderHook(() => useFilePreview(docx(), null));
    await waitFor(() => expect(store.ensureLocal).toHaveBeenCalled());
    expect(store.ensureLocal.mock.calls[0][2]).toMatchObject({ variant: "pdf", ext: "pdf" });
  });

  it("never puts a view-only file on disk", async () => {
    // The whole point of view_only is that no copy outlives the session.
    renderHook(() => useFilePreview(doc({ lock_mode: "view_only" }), null));
    await waitFor(() => expect(mockGet).not.toHaveBeenCalled());
    expect(store.ensureLocal).not.toHaveBeenCalled();
    expect(store.localUri).not.toHaveBeenCalled();
  });

  it("never puts a locked file on disk before it is unlocked", async () => {
    renderHook(() => useFilePreview(doc({ lock_mode: "full_lock" }), null));
    await waitFor(() => expect(store.ensureLocal).not.toHaveBeenCalled());
    expect(store.localUri).not.toHaveBeenCalled();
  });

  it("leaves text previews on the network - fetch cannot read a file:// URL", async () => {
    renderHook(() => useFilePreview(makeFile(), null));
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(store.ensureLocal).not.toHaveBeenCalled();
  });

  it("survives a cache that cannot be read", async () => {
    store.localUri.mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useFilePreview(doc(), null));
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
    expect(result.current.failed).toBe(false);
  });
});

describe("useFilePreview, available offline", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const read = require("@/offline/read") as { savedCopy: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require("@/offline/db") as Record<string, jest.Mock>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sync = require("@/offline/sync") as Record<string, jest.Mock>;
  const SAVED = "file:///docs/offline/acct/files/f1-v3.pdf";
  const pdf = (over: Partial<FileDetail> = {}) =>
    makeFile({ name: "deck.pdf", mime_type: "application/pdf", extension: ".pdf", ...over });
  const docx = (over: Partial<FileDetail> = {}) => makeFile({
    name: "report.docx", extension: ".docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ...over,
  });
  const noOfflineWrites = () => {
    for (const fn of [...Object.values(db), ...Object.values(sync)]) {
      if (typeof fn === "function" && "mock" in fn) expect(fn).not.toHaveBeenCalled();
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnline.value = true;
    mockGet.mockResolvedValue("https://r2.test/presigned");
    store.localUri.mockResolvedValue(null);
    store.ensureLocal.mockResolvedValue(null);
    read.savedCopy.mockResolvedValue(null);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "network text" })) as never;
  });

  it("a current saved copy opens from the phone and never presigns", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 3, rendition: "none" });
    const { result } = renderHook(() => useFilePreview(pdf(), null));
    await waitFor(() => expect(result.current.uri).toBe(SAVED));
    expect(result.current).toMatchObject({ source: "saved", headers: undefined, newerAvailable: false, updatePending: false });
    expect(mockGet).not.toHaveBeenCalled();
    expect(store.ensureLocal).not.toHaveBeenCalled();
  });

  it("files, online, outdated saved copy: saved + newer bar, no stream until asked", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    const { result } = renderHook(() => useFilePreview(pdf({ current_version: 3 }), null));
    await waitFor(() => expect(result.current.uri).toBe(SAVED));
    expect(result.current).toMatchObject({ newerAvailable: true, updatePending: false });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("Open newer version streams and does not write to the offline store", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    const { result, rerender } = renderHook(
      ({ asked }: { asked: boolean }) => useFilePreview(pdf({ current_version: 3 }), null, { userAskedNewer: asked }),
      { initialProps: { asked: false } },
    );
    await waitFor(() => expect(result.current.uri).toBe(SAVED));
    rerender({ asked: true });
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
    expect(result.current).toMatchObject({ source: "stream", newerAvailable: false });
    noOfflineWrites();
  });

  it("offline screen, online, outdated: saved, never stream", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    const { result } = renderHook(() =>
      useFilePreview(pdf({ current_version: 3 }), null, { origin: "offline-screen", userAskedNewer: true }));
    await waitFor(() => expect(result.current.uri).toBe(SAVED));
    expect(result.current).toMatchObject({ updatePending: true, newerAvailable: false });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("offline, outdated: saved with update pending, nothing fetched", async () => {
    mockOnline.value = false;
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 2, rendition: "none" });
    const { result } = renderHook(() => useFilePreview(pdf({ current_version: 3 }), null, { userAskedNewer: true }));
    await waitFor(() => expect(result.current.uri).toBe(SAVED));
    expect(result.current.updatePending).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("nothing reaches the network before the saved copy is known", async () => {
    let resolve!: (v: unknown) => void;
    read.savedCopy.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useFilePreview(pdf(), null));
    expect(result.current.uri).toBeNull();
    expect(result.current.source).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
    resolve(null);
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
  });

  it("an office file opens its saved PDF", async () => {
    read.savedCopy.mockImplementation(async (_id: string, o?: { variant?: string }) =>
      o?.variant === "pdf" ? { uri: "file:///docs/offline/acct/files/f1-v3-pdf.pdf", version: 3, rendition: "ready" }
        : { uri: "file:///docs/offline/acct/files/f1-v3.docx", version: 3, rendition: "ready" });
    const { result } = renderHook(() => useFilePreview(docx(), null));
    await waitFor(() => expect(result.current.uri).toBe("file:///docs/offline/acct/files/f1-v3-pdf.pdf"));
    expect(result.current.renditionUnavailable).toBe(false);
  });

  it("an office file saved without its PDF, offline: preview unavailable, nothing fetched", async () => {
    mockOnline.value = false;
    read.savedCopy.mockImplementation(async (_id: string, o?: { variant?: string }) =>
      o?.variant === "pdf" ? null : { uri: "file:///docs/offline/acct/files/f1-v3.docx", version: 3, rendition: "failed" });
    const { result } = renderHook(() => useFilePreview(docx(), null));
    await waitFor(() => expect(result.current.renditionUnavailable).toBe(true));
    expect(result.current.uri).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("an office file saved without its PDF, online from Files: the conversion streams as usual", async () => {
    read.savedCopy.mockImplementation(async (_id: string, o?: { variant?: string }) =>
      o?.variant === "pdf" ? null : { uri: "file:///docs/offline/acct/files/f1-v3.docx", version: 3, rendition: "skipped" });
    const { result } = renderHook(() => useFilePreview(docx(), null));
    await waitFor(() => expect(result.current.uri).toBe("https://api.test/api/files/f1/preview-pdf"));
    expect(result.current.renditionUnavailable).toBe(false);
  });

  it("a saved text file is read from disk, not fetched", async () => {
    read.savedCopy.mockResolvedValue({ uri: "file:///docs/offline/acct/files/f1-v3.txt", version: 3, rendition: "none" });
    const { result } = renderHook(() => useFilePreview(makeFile(), null));
    await waitFor(() => expect(result.current.text).toBe("saved text"));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Retry looks the saved copy up again", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 3, rendition: "none" });
    const { result } = renderHook(() => useFilePreview(pdf(), null));
    await waitFor(() => expect(result.current.uri).toBe(SAVED));
    read.savedCopy.mockResolvedValue(null); // removed while open
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.uri).toBe("https://r2.test/presigned"));
  });

  it("a file locked since it was saved is not shown from the phone", async () => {
    read.savedCopy.mockResolvedValue({ uri: SAVED, version: 3, rendition: "none" });
    const { result } = renderHook(() => useFilePreview(pdf({ lock_mode: "view_only" }), null));
    await waitFor(() => expect(result.current.uri).toContain("/api/files/f1/raw"));
    expect(read.savedCopy).not.toHaveBeenCalled();
  });
});
