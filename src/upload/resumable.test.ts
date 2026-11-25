jest.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  cacheDirectory: "file:///cache/",
  readAsStringAsync: jest.fn(async () => "b64chunk"),
  writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  uploadAsync: jest.fn(async () => ({ status: 201, body: "{}" })),
}));
jest.mock("@/api", () => ({ apiRequest: jest.fn(), API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

import { planParts, remainingParts, uploadResumable, type ResumableSession } from "./resumable";
import type { UploadItem } from "@/upload/types";
import { apiRequest } from "@/api";
import * as FileSystem from "expo-file-system/legacy";

const TEN_MB = 10 * 1024 * 1024;

function bigItem(): UploadItem {
  return { id: "bk_v1_1", name: "v.mp4", uri: "file://v", size: 25 * 1024 * 1024, mime: "video/mp4", folderId: "f1", workspaceId: "w1", status: "queued", progress: 0 };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default implementations cleared by jest.clearAllMocks() above
  // (mockClear() wipes call history but jest.fn(impl)'s initial impl set at
  // module-eval time is untouched - these two are re-asserted defensively
  // since individual tests override them with mockResolvedValueOnce chains).
  (FileSystem.uploadAsync as jest.Mock).mockResolvedValue({ status: 201, body: "{}" });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("b64chunk");
});

describe("planParts / remainingParts (pure)", () => {
  it("splits into 1-indexed 10MB parts with a short final part", () => {
    const plan = planParts(25 * 1024 * 1024, TEN_MB);
    expect(plan).toEqual([
      { partNumber: 1, position: 0, length: TEN_MB },
      { partNumber: 2, position: TEN_MB, length: TEN_MB },
      { partNumber: 3, position: 2 * TEN_MB, length: 5 * 1024 * 1024 },
    ]);
  });
  it("filters out already-uploaded part numbers", () => {
    const plan = planParts(25 * 1024 * 1024, TEN_MB);
    expect(remainingParts(plan, [1, 2]).map((p) => p.partNumber)).toEqual([3]);
  });
});

describe("uploadResumable", () => {
  it("inits, PUTs each remaining part, completes, and returns file.id", async () => {
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce({ ok: true, session_id: "upl_1", upload_url: "/api/upload/upl_1", resumable: { part_size: TEN_MB, total_parts: 3, part_upload_url: "/api/upload/upl_1/part", complete_url: "/api/upload/upl_1/complete", status_url: "/api/upload/upl_1/status" } }) // init
      .mockResolvedValueOnce({ ok: true, uploaded_parts: [1], total_parts: 3 }) // status (part 1 already done)
      .mockResolvedValueOnce({ ok: true, file: { id: "file_big" } }); // complete

    const progress: number[] = [];
    const id = await uploadResumable(bigItem(), "w1", (p) => progress.push(p));

    expect(id).toBe("file_big");
    // parts 2 and 3 uploaded (part 1 skipped by resume)
    expect((FileSystem.uploadAsync as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      "https://api.test/api/upload/upl_1/part/2",
      "https://api.test/api/upload/upl_1/part/3",
    ]);
    expect(progress[progress.length - 1]).toBeCloseTo(1, 5);
    // temp part files cleaned up
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2);
  });

  // Photo backup names its uploads `bk_<asset.id>_<n>`, and an iOS Photos id is
  // "<UUID>/L0/001". Used raw, the slashes put each part's temp file inside
  // directories that do not exist, and every video over 50 MB failed with
  // "Calling the 'writeAsStringAsync' function has failed".
  it("keeps each part's temp file directly in the cache for an iOS asset id", async () => {
    const savedSession: ResumableSession = {
      sessionId: "upl_ios",
      partSize: TEN_MB,
      partUploadUrl: "/api/upload/upl_ios/part",
      statusUrl: "/api/upload/upl_ios/status",
      completeUrl: "/api/upload/upl_ios/complete",
    };
    const item: UploadItem = {
      id: "bk_ED7AC36B-A150-4C38-BB8C-B6D696F4F2ED/L0/001_3", name: "IMG_2974.MOV", uri: "file://mov",
      size: TEN_MB, mime: "video/quicktime", folderId: "f1", workspaceId: "w1", status: "queued", progress: 0,
    };
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce({ ok: true, uploaded_parts: [], total_parts: 1 })
      .mockResolvedValueOnce({ ok: true, file: { id: "file_mov" } });

    await uploadResumable(item, "w1", () => {}, { savedSession });

    const written = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(written).toHaveLength(1);
    expect(written[0].startsWith("file:///cache/")).toBe(true);
    expect(written[0].slice("file:///cache/".length)).not.toContain("/");
    // The upload and the cleanup use the same path that was written.
    expect((FileSystem.uploadAsync as jest.Mock).mock.calls[0][1]).toBe(written[0]);
    expect((FileSystem.deleteAsync as jest.Mock).mock.calls[0][0]).toBe(written[0]);
  });

  it("resumes with a saved session - skips init entirely, PUTs only the remaining part, and completes", async () => {
    // A 2-part file (20MB @ 10MB parts). status_url says part 1 is already
    // stored server-side from a prior killed run - only part 2 should PUT.
    const savedSession: ResumableSession = {
      sessionId: "upl_resume",
      partSize: TEN_MB,
      partUploadUrl: "/api/upload/upl_resume/part",
      statusUrl: "/api/upload/upl_resume/status",
      completeUrl: "/api/upload/upl_resume/complete",
    };
    const item: UploadItem = { id: "bk_v2_1", name: "v.mp4", uri: "file://v2", size: 2 * TEN_MB, mime: "video/mp4", folderId: "f1", workspaceId: "w1", status: "queued", progress: 0 };

    (apiRequest as jest.Mock)
      .mockResolvedValueOnce({ ok: true, uploaded_parts: [1], total_parts: 2 }) // status
      .mockResolvedValueOnce({ ok: true, file: { id: "file_resumed" } }); // complete

    const onSession = jest.fn(async () => {});
    const id = await uploadResumable(item, "w1", () => {}, { savedSession, onSession });

    expect(id).toBe("file_resumed");
    // Reused the saved session - onSession (which persists a *new* session)
    // must never fire, and /api/upload/init must never be called.
    expect(onSession).not.toHaveBeenCalled();
    expect((apiRequest as jest.Mock).mock.calls.some((c) => c[0] === "/api/upload/init")).toBe(false);
    // Only the remaining part (2) is PUT - part 1 is skipped by real resume.
    expect((FileSystem.uploadAsync as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      "https://api.test/api/upload/upl_resume/part/2",
    ]);
  });

  it("rejects on a part upload failure and still cleans up that part's temp file", async () => {
    (apiRequest as jest.Mock)
      .mockResolvedValueOnce({ ok: true, session_id: "upl_2", upload_url: "/api/upload/upl_2", resumable: { part_size: TEN_MB, total_parts: 3, part_upload_url: "/api/upload/upl_2/part", complete_url: "/api/upload/upl_2/complete", status_url: "/api/upload/upl_2/status" } }) // init
      .mockResolvedValueOnce({ ok: true, uploaded_parts: [], total_parts: 3 }); // status - nothing uploaded yet

    (FileSystem.uploadAsync as jest.Mock).mockResolvedValueOnce({ status: 500, body: "" });

    // The WORDING is load-bearing, not cosmetic: the upload controller decides
    // whether to retry by matching markers against the message, and one of them
    // is "upload failed (5". A 5xx on part 1 of a 13-part video has to be
    // retryable, or one blip on a mobile network fails the whole file for good.
    const err = await uploadResumable(bigItem(), "w1", () => {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Part 1 upload failed (500)");
    // The marker itself, spelled out: this is what the controller matches on.
    expect((err as Error).message.toLowerCase()).toContain("upload failed (5");
    // finally-block cleanup still ran for the failed part's temp file.
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  });
});
