type ProgressCb = (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void;

/**
 * A stand-in for expo's resumable download. It reports two progress ticks and
 * then resolves, which is the shape the real one has and the shape the caller
 * has to survive: the callback fires before the promise settles.
 */
const resumable = {
  ticks: [
    { totalBytesWritten: 25, totalBytesExpectedToWrite: 100 },
    { totalBytesWritten: 100, totalBytesExpectedToWrite: 100 },
  ],
  result: { uri: "", status: 200 } as { uri: string; status: number },
  cancelled: false,
};

const mockDisk = new Map<string, string>();
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  deleteAsync: jest.fn(async (p: string) => { mockDisk.delete(p); }),
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async (p: string) => ({ exists: mockDisk.has(p), isDirectory: false, size: 100 })),
  readDirectoryAsync: jest.fn(async () => [] as string[]),
  readAsStringAsync: jest.fn(async (p: string) => {
    if (!mockDisk.has(p)) throw new Error("ENOENT");
    return mockDisk.get(p) as string;
  }),
  writeAsStringAsync: jest.fn(async (p: string, v: string) => { mockDisk.set(p, v); }),
  createDownloadResumable: jest.fn(
    (_url: string, dest: string, _opts: unknown, cb?: ProgressCb) => ({
      downloadAsync: async () => {
        if (cb) resumable.ticks.forEach((t) => cb(t));
        mockDisk.set(dest, "bytes");
        return { uri: resumable.result.uri || dest, status: resumable.result.status };
      },
      cancelAsync: async () => { resumable.cancelled = true; },
    }),
  ),
}));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

import { downloadToCache, shareFile } from "./download";
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { ApiError } from "@/api/errors";

// Locked and view-only files take this path. They used to land loose in the
// cache root, where nothing ever evicted them; now they go through the byte
// store's transient area, which is capped (LRU) and swept at launch.
const TRANSIENT = "file:///cache/files/transient/";

describe("download util", () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockDisk.clear();
    resumable.result = { uri: "", status: 200 };
    resumable.cancelled = false;
  });

  it("downloads into the byte store's transient area, not the cache root, and returns the local uri", async () => {
    const uri = await downloadToCache("https://r2/x", "report.pdf");
    expect(uri).toBe(`${TRANSIENT}report.pdf`);
    // No headers for a presigned URL - it carries its own credential.
    expect(FS.createDownloadResumable).toHaveBeenCalledWith(
      "https://r2/x",
      `${TRANSIENT}report.pdf`,
      {},
      undefined,
    );
    // Registered with the LRU so it can be evicted.
    expect(JSON.parse(mockDisk.get(`${TRANSIENT}index.json`) as string)).toEqual([
      expect.objectContaining({ fileId: "transient:report.pdf", sizeBytes: 100 }),
    ]);
  });

  it("forwards headers, so a view-only file can be read from the authenticated /raw route", async () => {
    await downloadToCache("https://api/files/f1/raw", "report.pdf", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(FS.createDownloadResumable).toHaveBeenCalledWith(
      "https://api/files/f1/raw",
      `${TRANSIENT}report.pdf`,
      { headers: { Authorization: "Bearer tok" } },
      undefined,
    );
  });

  // The reason this path moved off downloadAsync at all: it has no progress
  // callback, so a view-only or locked file could only ever show a spinner.
  it("reports bytes as they land, so a long download is not a silent spinner", async () => {
    const seen: [number, number][] = [];
    await downloadToCache("https://r2/x", "big.mp4", {
      onProgress: (written, total) => seen.push([written, total]),
    });
    expect(seen).toEqual([
      [25, 100],
      [100, 100],
    ]);
  });

  // View-only and locked files take this path, so without a handle here they
  // would be the one kind of download that still could not be stopped.
  it("hands the caller a way to stop the download it just started", async () => {
    let stop: (() => Promise<void>) | null = null;
    await downloadToCache("https://r2/x", "big.mp4", { onTask: (t) => { stop = () => t.cancelAsync(); } });
    expect(stop).not.toBeNull();
    await stop!();
    expect(resumable.cancelled).toBe(true);
  });

  it("rejects with ApiError and deletes the partial file on an HTTP error status", async () => {
    resumable.result = { uri: "file:///cache/x", status: 403 };
    let caught: unknown;
    try {
      await downloadToCache("https://r2/x", "report.pdf");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 403 });
    expect(FS.deleteAsync).toHaveBeenCalledWith("file:///cache/x", { idempotent: true });
  });

  it("resolves the uri on a 200 status", async () => {
    resumable.result = { uri: `${TRANSIENT}ok.pdf`, status: 200 };
    const uri = await downloadToCache("https://r2/x", "ok.pdf");
    expect(uri).toBe(`${TRANSIENT}ok.pdf`);
  });

  it("shares an available file", async () => {
    await shareFile("file:///cache/report.pdf");
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/report.pdf");
  });

  it("throws if sharing is unavailable", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await expect(shareFile("file:///cache/report.pdf")).rejects.toThrow();
  });
});
