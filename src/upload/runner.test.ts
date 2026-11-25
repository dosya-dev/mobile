const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));
import { uploadOne, sweepUploadCache, __resetDirectCapability } from "./runner";
import type { UploadItem } from "./types";

jest.mock("@/api", () => ({ apiRequest: jest.fn(), API_BASE_URL: "https://api.dosya.dev" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "dosm_tok" }));
const mockUploadResumable = jest.fn();
jest.mock("./resumable", () => ({ uploadResumable: (...a: unknown[]) => mockUploadResumable(...a) }));
const mockUploadAsync = jest.fn();
jest.mock("expo-file-system/legacy", () => ({
  FileSystemUploadType: { BINARY_CONTENT: "BINARY_CONTENT" },
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///docs/",
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => [] as string[]),
  // The source is stat'ed right before every native upload attempt (see
  // runner.ts); default to "present" so the existing cases are unchanged.
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  createUploadTask: jest.fn((_url: string, _uri: string, _opts: any, _cb: any) => ({ uploadAsync: mockUploadAsync })),
}));

import { apiRequest } from "@/api";
import * as FS from "expo-file-system/legacy";

const item: UploadItem = { id: "u1", name: "p.jpg", uri: "file://p", size: 100, mime: "image/jpeg", folderId: "fold1", workspaceId: "w1", status: "queued", progress: 0 };

describe("uploadOne", () => {
  beforeEach(() => {
    mockMem.clear();
    __resetDirectCapability();
  });
  afterEach(() => jest.clearAllMocks());

  it("tries an out-of-sandbox source DIRECTLY first and remembers the device can (no copy)", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true, file: { id: "file_123" } }) });
    const id = await uploadOne(item, "w1", () => {});
    expect(FS.copyAsync).not.toHaveBeenCalled();
    expect(FS.createUploadTask).toHaveBeenCalledWith(
      "https://api.dosya.dev/api/upload/s1", "file://p",
      expect.objectContaining({ httpMethod: "PUT", headers: expect.objectContaining({ Authorization: "Bearer dosm_tok", "Content-Type": "image/jpeg" }) }),
      expect.any(Function),
    );
    expect(mockMem.get("dosya.upload.directCapability")).toBe("direct");
    expect(id).toEqual({ fileId: "file_123", sizeBytes: null });
  });

  /**
   * expo's createUploadTask has no exists check and runs on a background
   * NSURLSession, which throws an uncatchable NSInvalidArgumentException when
   * the source cannot be opened - that aborted a whole overnight backup at
   * 01:47 after a staged copy had been swept. The stat turns it into this
   * item's error.
   */
  it("fails the item, not the process, when an in-sandbox source has vanished", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    (FS.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });
    const staged = { ...item, uri: "file:///cache/upload-staged-u1" };
    await expect(uploadOne(staged, "w1", () => {})).rejects.toThrow(/Source file is missing/);
    expect(FS.createUploadTask).not.toHaveBeenCalled();
    // Not a read failure of the device: it must not flip into copy mode.
    expect(mockMem.get("dosya.upload.directCapability")).toBeUndefined();
  });

  it("does not stat a Photos-library source - the direct read decides that", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true, file: { id: "file_123" } }) });
    await uploadOne(item, "w1", () => {});
    expect(FS.getInfoAsync).not.toHaveBeenCalled();
    expect(FS.createUploadTask).toHaveBeenCalledTimes(1);
  });

  it("falls back to copy+retry on a read failure and remembers the device needs copies", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync
      .mockRejectedValueOnce(new Error("The file couldn’t be opened. NSURLErrorDomain error -1."))
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true, file: { id: "file_123" } }) });
    const id = await uploadOne(item, "w1", () => {});
    expect(FS.copyAsync).toHaveBeenCalledWith({ from: "file://p", to: "file:///cache/upload-u1" });
    expect(FS.createUploadTask).toHaveBeenLastCalledWith(
      "https://api.dosya.dev/api/upload/s1", "file:///cache/upload-u1", expect.anything(), expect.any(Function),
    );
    expect(FS.deleteAsync).toHaveBeenCalledWith("file:///cache/upload-u1", { idempotent: true });
    expect(mockMem.get("dosya.upload.directCapability")).toBe("copy");
    expect(id).toEqual({ fileId: "file_123", sizeBytes: null });
  });

  it("copies up-front once the device is known to need copies", async () => {
    mockMem.set("dosya.upload.directCapability", "copy");
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true, file: { id: "file_123" } }) });
    await uploadOne(item, "w1", () => {});
    expect(FS.copyAsync).toHaveBeenCalledTimes(1);
    expect(mockUploadAsync).toHaveBeenCalledTimes(1); // no failed direct attempt
  });

  it("does NOT flip to copy mode on a network failure (rethrows)", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockRejectedValue(new Error("NSURLErrorDomain error -1009: offline"));
    await expect(uploadOne(item, "w1", () => {})).rejects.toThrow(/-1009/);
    expect(FS.copyAsync).not.toHaveBeenCalled();
    expect(mockMem.has("dosya.upload.directCapability")).toBe(false);
  });

  it("skips the copy when the source is already in the sandbox cache", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true, file: { id: "f2" } }) });
    await uploadOne({ ...item, uri: "file:///cache/ImagePicker/x.jpg" }, "w1", () => {});
    expect(FS.copyAsync).not.toHaveBeenCalled();
    expect(FS.createUploadTask).toHaveBeenCalledWith(
      "https://api.dosya.dev/api/upload/s1", "file:///cache/ImagePicker/x.jpg", expect.anything(), expect.any(Function),
    );
  });

  // A file over the server's multipart threshold used to throw "Large files
  // (over 50 MB) aren't supported for mobile upload yet." - the manual queue
  // only ever spoke single PUT, while the photo backup path had a complete
  // resumable uploader sitting next to it.
  describe("a large (resumable) file", () => {
    const big2 = (session: unknown) => ({ ...big, resumableSession: session });
    const big: UploadItem = { ...item, name: "clip.mp4", size: 122 * 1024 * 1024, mime: "video/mp4" };
    const resumableInit = {
      ok: true,
      session_id: "s1",
      upload_url: "/api/upload/s1",
      resumable: {
        part_size: 10 * 1024 * 1024,
        total_parts: 13,
        part_upload_url: "/api/upload/s1/part",
        complete_url: "/api/upload/s1/complete",
        status_url: "/api/upload/s1/status",
      },
    };

    it("uploads it in parts instead of refusing", async () => {
      (apiRequest as jest.Mock).mockResolvedValue(resumableInit);
      mockUploadResumable.mockResolvedValue("file_big");

      await expect(uploadOne(big, "w1", () => {})).resolves.toEqual({ fileId: "file_big", sizeBytes: null });
      expect(mockUploadResumable).toHaveBeenCalledTimes(1);
    });

    // The trap: uploadResumable inits its OWN session when it is not handed
    // one. Calling it bare here would orphan the session this function just
    // created - and each session holds a workspace concurrency slot until the
    // server reclaims it 15 minutes later, so a couple of retries could lock
    // the user out of every transfer.
    it("hands over the session it already opened rather than opening a second one", async () => {
      (apiRequest as jest.Mock).mockResolvedValue(resumableInit);
      mockUploadResumable.mockResolvedValue("file_big");

      await uploadOne(big, "w1", () => {});

      const inits = (apiRequest as jest.Mock).mock.calls.filter((c) => c[0] === "/api/upload/init");
      expect(inits).toHaveLength(1);
      expect(mockUploadResumable).toHaveBeenCalledWith(
        big,
        "w1",
        expect.any(Function),
        {
          savedSession: {
            sessionId: "s1",
            partSize: 10 * 1024 * 1024,
            partUploadUrl: "/api/upload/s1/part",
            completeUrl: "/api/upload/s1/complete",
            statusUrl: "/api/upload/s1/status",
          },
        },
      );
    });

    it("reports part progress to the caller", async () => {
      (apiRequest as jest.Mock).mockResolvedValue(resumableInit);
      mockUploadResumable.mockImplementation(async (_i: unknown, _w: unknown, onProgress: (p: number) => void) => {
        onProgress(0.5);
        return "file_big";
      });
      const seen: number[] = [];
      await uploadOne(big, "w1", (p) => seen.push(p));
      expect(seen).toContain(0.5);
    });

    // Retrying a 122 MB video from part 1 is wasteful, and re-initing spawns a
    // SECOND session whose slot is held for 15 minutes - so a retry storm can
    // lock the account out of transfers. The session is handed back to the
    // caller to store on the item instead.
    it("reports its session so a retry can resume instead of re-initing", async () => {
      (apiRequest as jest.Mock).mockResolvedValue(resumableInit);
      mockUploadResumable.mockResolvedValue("file_big");
      const onSession = jest.fn();

      await uploadOne(big, "w1", () => {}, { onSession });

      expect(onSession).toHaveBeenCalledWith({
        sessionId: "s1",
        partSize: 10 * 1024 * 1024,
        partUploadUrl: "/api/upload/s1/part",
        completeUrl: "/api/upload/s1/complete",
        statusUrl: "/api/upload/s1/status",
      });
    });

    it("resumes a stored session without touching init at all", async () => {
      const stored = {
        sessionId: "s1", partSize: 10 * 1024 * 1024,
        partUploadUrl: "/api/upload/s1/part",
        completeUrl: "/api/upload/s1/complete",
        statusUrl: "/api/upload/s1/status",
      };
      mockUploadResumable.mockResolvedValue("file_big");

      await uploadOne({ ...big, resumableSession: stored }, "w1", () => {});

      expect(apiRequest as jest.Mock).not.toHaveBeenCalled();
      expect(mockUploadResumable).toHaveBeenCalledWith(big2(stored), "w1", expect.any(Function), { savedSession: stored });
    });

    // A stored session the server has already swept would fail forever. One
    // resumed attempt, then the session is dropped so the next retry re-inits.
    it("drops a stored session when resuming with it fails", async () => {
      const stored = {
        sessionId: "dead", partSize: 10, partUploadUrl: "/p", completeUrl: "/c", statusUrl: "/s",
      };
      mockUploadResumable.mockRejectedValue(new Error("Part 1 upload failed (404)"));
      const onSession = jest.fn();

      await expect(
        uploadOne({ ...big, resumableSession: stored }, "w1", () => {}, { onSession }),
      ).rejects.toThrow(/404/);

      expect(onSession).toHaveBeenCalledWith(null);
    });

    it("never opens a native single-PUT task for it", async () => {
      (apiRequest as jest.Mock).mockResolvedValue(resumableInit);
      mockUploadResumable.mockResolvedValue("file_big");
      await uploadOne(big, "w1", () => {});
      expect(FS.createUploadTask).not.toHaveBeenCalled();
    });

    // An older API that flags a file resumable but sends no part URLs would
    // otherwise have uploadResumable PUT parts at "undefined/1".
    it("refuses clearly when the server flags it resumable but sends no part URLs", async () => {
      (apiRequest as jest.Mock).mockResolvedValue({
        ok: true, session_id: "s1", upload_url: "/api/upload/s1",
        resumable: { part_size: 10, total_parts: 13 },
      });
      await expect(uploadOne(big, "w1", () => {})).rejects.toThrow(/resumable/i);
      expect(mockUploadResumable).not.toHaveBeenCalled();
    });
  });

  it("throws when the PUT returns an error status", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockResolvedValue({ status: 413, body: JSON.stringify({ ok: false, error: "Too large" }) });
    await expect(uploadOne(item, "w1", () => {})).rejects.toThrow("Too large");
  });
});

describe("uploadOne - the server's own byte count", () => {
  /**
   * H1 compares this with the local size and fails a short upload. Every other
   * spec in this suite stubs the parse away, so without this one the field
   * could be renamed server-side and the size check would quietly never fire.
   */
  const body201 = JSON.stringify({
    ok: true,
    file: {
      id: "file_123", name: "p.jpg", r2_key: "w1/file_123/p.jpg", size_bytes: 4096,
      mime_type: "image/jpeg", extension: ".jpg", region: "ap-southeast-2", version: 1, created_at: 1710000000,
    },
  });

  it("reads file.size_bytes out of the 201 the upload route returns", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    mockUploadAsync.mockResolvedValue({ status: 201, body: body201 });
    await expect(uploadOne(item, "w1", () => {})).resolves.toEqual({ fileId: "file_123", sizeBytes: 4096 });
  });

  it("reports no count when the response omits it or it is not a number", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, session_id: "s1", upload_url: "/api/upload/s1" });
    for (const file of [{ id: "f" }, { id: "f", size_bytes: "4096" }, { id: "f", size_bytes: null }]) {
      mockUploadAsync.mockResolvedValue({ status: 201, body: JSON.stringify({ ok: true, file }) });
      await expect(uploadOne(item, "w1", () => {})).resolves.toEqual({ fileId: "f", sizeBytes: null });
    }
  });
});

describe("sweepUploadCache", () => {
  it("deletes only orphaned upload-* temp files", async () => {
    (FS.readDirectoryAsync as jest.Mock).mockResolvedValue(["upload-a", "other.txt", "upload-b"]);
    await sweepUploadCache();
    expect(FS.deleteAsync).toHaveBeenCalledWith("file:///cache/upload-a", { idempotent: true });
    expect(FS.deleteAsync).toHaveBeenCalledWith("file:///cache/upload-b", { idempotent: true });
    expect(FS.deleteAsync).not.toHaveBeenCalledWith("file:///cache/other.txt", { idempotent: true });
  });

  it("leaves staged copies that the persisted upload queue still needs", async () => {
    (FS.readDirectoryAsync as jest.Mock).mockResolvedValue(["upload-share-up_1.pdf", "upload-a", "upload-share-up_2.pdf"]);
    await sweepUploadCache(new Set(["file:///cache/upload-share-up_1.pdf"]));
    expect(FS.deleteAsync).toHaveBeenCalledWith("file:///cache/upload-a", { idempotent: true });
    expect(FS.deleteAsync).toHaveBeenCalledWith("file:///cache/upload-share-up_2.pdf", { idempotent: true });
    expect(FS.deleteAsync).not.toHaveBeenCalledWith("file:///cache/upload-share-up_1.pdf", { idempotent: true });
  });
});
