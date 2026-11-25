import * as FileSystem from "expo-file-system/legacy";
import {
  EMPTY_STATE, loadReadingState, saveReadingState,
  addBookmark, removeBookmark, hasBookmarkAt, createPositionSaver, updateReadingState,
} from "./readingState";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(async () => {}),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "test-uuid" }));
const fs = FileSystem as jest.Mocked<typeof FileSystem>;

beforeEach(() => jest.clearAllMocks());

describe("loadReadingState", () => {
  it("returns saved state", async () => {
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify({ version: 1, location: "cfi(/6/4)", percent: 0.5, bookmarks: [] }));
    const s = await loadReadingState("f1");
    expect(s.location).toBe("cfi(/6/4)");
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///docs/reader-state/f1.json");
  });
  it("returns EMPTY_STATE when file missing", async () => {
    fs.readAsStringAsync.mockRejectedValue(new Error("ENOENT"));
    expect(await loadReadingState("f1")).toEqual(EMPTY_STATE);
  });
  it("treats corrupt JSON as absent", async () => {
    fs.readAsStringAsync.mockResolvedValue("{not json");
    expect(await loadReadingState("f1")).toEqual(EMPTY_STATE);
  });
  it("treats wrong shape as absent", async () => {
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify({ hello: 1 }));
    expect(await loadReadingState("f1")).toEqual(EMPTY_STATE);
  });
});

describe("saveReadingState", () => {
  it("mkdirs idempotently and writes JSON", async () => {
    await saveReadingState("f1", { ...EMPTY_STATE, location: "x", percent: 0.2 });
    expect(fs.makeDirectoryAsync).toHaveBeenCalledWith("file:///docs/reader-state/", { intermediates: true });
    const [path, body] = fs.writeAsStringAsync.mock.calls[0];
    expect(path).toBe("file:///docs/reader-state/f1.json");
    expect(JSON.parse(body as string).location).toBe("x");
  });
});

describe("bookmarks (pure)", () => {
  it("adds with provided id and finds by location", () => {
    const s = addBookmark(EMPTY_STATE, "cfi(/6/4)", "Chapter 2 · 40%", "b1");
    expect(s.bookmarks).toHaveLength(1);
    expect(hasBookmarkAt(s, "cfi(/6/4)")?.id).toBe("b1");
    expect(hasBookmarkAt(s, "cfi(/9/9)")).toBeUndefined();
  });
  it("removes by id and does not mutate input", () => {
    const s1 = addBookmark(EMPTY_STATE, "l", "L", "b1");
    const s2 = removeBookmark(s1, "b1");
    expect(s2.bookmarks).toHaveLength(0);
    expect(s1.bookmarks).toHaveLength(1);
  });
});

describe("updateReadingState", () => {
  it("serializes overlapping updates for the same fileId so both land", async () => {
    // A tiny in-memory file store so a later load actually observes an
    // earlier write - a static mock would hide the very race being tested.
    const store = new Map<string, string>();
    fs.readAsStringAsync.mockImplementation(async (path: string) => {
      const body = store.get(path);
      if (body === undefined) throw new Error("ENOENT");
      return body;
    });
    let firstWriteStarted: () => void = () => {};
    const firstWriteStartedGate = new Promise<void>((resolve) => { firstWriteStarted = resolve; });
    let releaseFirstWrite: () => void = () => {};
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let writeCount = 0;
    fs.writeAsStringAsync.mockImplementation(async (path: string, body: string) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted();
        await firstWriteGate; // hold the first write in flight
      }
      store.set(path, body);
    });

    const p1 = updateReadingState("f1", (s) => addBookmark(s, "cfi(a)", "A", "b1"));
    await firstWriteStartedGate; // call 1's write is now genuinely in flight
    const p2 = updateReadingState("f1", (s) => addBookmark(s, "cfi(b)", "B", "b2"));

    releaseFirstWrite();
    await Promise.all([p1, p2]);

    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(2);
    const finalBody = JSON.parse(store.get("file:///docs/reader-state/f1.json") as string) as {
      bookmarks: { id: string }[];
    };
    expect(finalBody.bookmarks.map((b) => b.id).sort()).toEqual(["b1", "b2"]);
  });

  it("does not wedge the queue after a rejected write", async () => {
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify(EMPTY_STATE));
    fs.writeAsStringAsync.mockRejectedValueOnce(new Error("disk full"));
    fs.writeAsStringAsync.mockResolvedValueOnce(undefined);

    await expect(
      updateReadingState("f1", (s) => addBookmark(s, "cfi(a)", "A", "b1")),
    ).rejects.toThrow("disk full");

    const second = await updateReadingState("f1", (s) => addBookmark(s, "cfi(b)", "B", "b2"));
    expect(second.bookmarks.map((b) => b.id)).toEqual(["b2"]);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(2);
  });
});

describe("createPositionSaver", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it("debounces writes and keeps existing bookmarks", async () => {
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify(addBookmark(EMPTY_STATE, "l", "L", "b1")));
    const saver = createPositionSaver("f1", 2000);
    saver.update("cfi(a)", 0.1);
    saver.update("cfi(b)", 0.2);
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2000);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fs.writeAsStringAsync.mock.calls[0][1] as string);
    expect(body.location).toBe("cfi(b)");
    expect(body.bookmarks).toHaveLength(1); // merged, not clobbered
  });
  it("flush writes immediately", async () => {
    fs.readAsStringAsync.mockRejectedValue(new Error("ENOENT"));
    const saver = createPositionSaver("f1", 2000);
    saver.update("cfi(c)", 0.3);
    await saver.flush();
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1); // timer cancelled
  });
  it("handles rejected writes in debounced path and allows subsequent flush", async () => {
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify(EMPTY_STATE));
    fs.writeAsStringAsync.mockRejectedValueOnce(new Error("disk full"));
    const saver = createPositionSaver("f1", 1000);
    saver.update("cfi(x)", 0.5);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
    // Reset mock for subsequent flush
    fs.writeAsStringAsync.mockClear().mockResolvedValue(undefined);
    fs.readAsStringAsync.mockClear().mockResolvedValue(JSON.stringify(EMPTY_STATE));
    // Flush should succeed (no throw from the previous rejection)
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  });
});
