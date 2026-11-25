import * as FileSystem from "expo-file-system/legacy";
import { ensureBookCached, bookCachePath, bookTempPath, releaseOpenBooks, _resetForTests } from "./bookCache";
import { ensureLocal, storePath } from "@/files/byteStore";

const mockDownloadAsync = jest.fn();
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(() => ({ downloadAsync: mockDownloadAsync })),
}));
jest.mock("@/files/byteStore", () => ({
  ensureLocal: jest.fn(async () => "file:///cache/files/f1-v3.epub"),
  storePath: jest.fn((f: { id: string; current_version: number }) => `file:///cache/files/${f.id}-v${f.current_version}.epub`),
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const store = { ensureLocal: ensureLocal as jest.Mock, storePath: storePath as jest.Mock };

const meta = { id: "f1", current_version: 3, extension: "epub", name: "book.epub", size_bytes: 10, lock_mode: "none" };
const viewOnly = { ...meta, lock_mode: "view_only" };

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  store.ensureLocal.mockResolvedValue("file:///cache/files/f1-v3.epub");
  store.storePath.mockImplementation((f: { id: string; current_version: number }) => `file:///cache/files/${f.id}-v${f.current_version}.epub`);
  mockDownloadAsync.mockResolvedValue({ status: 200, uri: "file:///cache/books-open/f1-v3.epub" });
});

describe("a book the reader may keep", () => {
  it("goes through the shared byte store, so it is capped and reused", async () => {
    const getUrl = async () => "https://r2/presigned";
    const uri = await ensureBookCached(meta, getUrl);
    expect(store.ensureLocal).toHaveBeenCalled();
    expect(uri).toBe("file:///cache/files/f1-v3.epub");
    // No second downloader: the store owns fetching now.
    expect(fs.createDownloadResumable).not.toHaveBeenCalled();
  });

  it("clears the old uncapped books directory, which had no eviction at all", async () => {
    await ensureBookCached(meta, async () => "https://r2/presigned");
    expect(fs.deleteAsync).toHaveBeenCalledWith("file:///cache/books/", { idempotent: true });
  });

  it("is still readable when it is too big for the store to keep", async () => {
    // A book larger than the whole cache budget: the store declines, but the
    // reader still has to be able to open it.
    store.ensureLocal.mockResolvedValue(null);
    const uri = await ensureBookCached(meta, async () => "https://r2/presigned");
    expect(uri).toBe(bookTempPath(meta));
  });
});

describe("a view-only book", () => {
  // The reader needs a path - a book cannot be streamed - so opening one means
  // writing bytes to disk. It must not be written where it survives the read.
  it("never reaches the store that keeps things", async () => {
    await ensureBookCached(viewOnly, async () => "https://api/raw", undefined, { Authorization: "Bearer t" });
    expect(store.ensureLocal).not.toHaveBeenCalled();
  });

  it("is written to the held-open directory, not the kept one", async () => {
    const uri = await ensureBookCached(viewOnly, async () => "https://api/raw");
    expect(uri).toBe("file:///cache/books-open/f1-v3.epub");
    expect(bookCachePath(viewOnly)).toBe(bookTempPath(viewOnly));
  });

  it("clears whatever was held open BEFORE writing, never after", async () => {
    // Emptying the directory once the new book had landed would delete the
    // book being opened.
    fs.readDirectoryAsync.mockResolvedValue(["stale-v1.epub"] as never);
    const order: string[] = [];
    fs.deleteAsync.mockImplementation(async (p: string) => { order.push(`delete:${p}`); });
    mockDownloadAsync.mockImplementation(async () => {
      order.push("download");
      return { status: 200, uri: "file:///cache/books-open/f1-v3.epub" };
    });
    await ensureBookCached(viewOnly, async () => "https://api/raw");
    expect(order).toEqual(["delete:file:///cache/books-open/stale-v1.epub", "download"]);
  });

  it("carries the bearer token, since a view-only book cannot be presigned", async () => {
    await ensureBookCached(viewOnly, async () => "https://api/raw", undefined, { Authorization: "Bearer t" });
    expect(fs.createDownloadResumable).toHaveBeenCalledWith(
      "https://api/raw",
      "file:///cache/books-open/f1-v3.epub",
      { headers: { Authorization: "Bearer t" } },
      expect.any(Function),
    );
  });

  it("leaves nothing on disk when the server refuses", async () => {
    mockDownloadAsync.mockResolvedValue({ status: 403, uri: "file:///cache/books-open/f1-v3.epub" });
    await expect(ensureBookCached(viewOnly, async () => "https://api/raw")).rejects.toThrow();
    expect(fs.deleteAsync).toHaveBeenCalledWith("file:///cache/books-open/f1-v3.epub", { idempotent: true });
  });

  it("is also refused a kept copy when it is locked rather than view-only", async () => {
    await ensureBookCached({ ...meta, lock_mode: "full_lock" }, async () => "https://api/raw");
    expect(store.ensureLocal).not.toHaveBeenCalled();
  });
});

describe("releaseOpenBooks", () => {
  it("empties the held-open directory", async () => {
    fs.readDirectoryAsync.mockResolvedValue(["a.epub", "b.pdf"] as never);
    await releaseOpenBooks();
    expect(fs.deleteAsync).toHaveBeenCalledWith("file:///cache/books-open/a.epub", { idempotent: true });
    expect(fs.deleteAsync).toHaveBeenCalledWith("file:///cache/books-open/b.pdf", { idempotent: true });
  });

  it("is quiet when there is nothing held open", async () => {
    fs.readDirectoryAsync.mockRejectedValue(new Error("ENOENT"));
    await expect(releaseOpenBooks()).resolves.toBeUndefined();
  });
});

describe("bookTempPath", () => {
  it("names the file from its extension, then its name, then bin", () => {
    expect(bookTempPath(viewOnly)).toBe("file:///cache/books-open/f1-v3.epub");
    expect(bookTempPath({ ...viewOnly, extension: null, name: "weird name.MOBI" }))
      .toBe("file:///cache/books-open/f1-v3.mobi");
    expect(bookTempPath({ ...viewOnly, extension: null, name: "noext" }))
      .toBe("file:///cache/books-open/f1-v3.bin");
  });
});
