import { buildTracks, fetchAllAudioTracks, trackTitle, QUEUE_CAP } from "./queue";
import { listFiles } from "@/files/api";
import type { FileItem, FileListPage } from "@/files/types";

jest.mock("@/files/api", () => ({ listFiles: jest.fn() }));
const mockListFiles = listFiles as jest.Mock;

const audio = (id: string, name: string, lock = "none"): FileItem =>
  ({ id, name, size_bytes: 1000, mime_type: "audio/mpeg", extension: "mp3", created_at: 1, updated_at: 5,
     current_version: 1, lock_mode: lock, share_count: 0, comment_count: 0 }) as FileItem;

const doc = (id: string): FileItem =>
  ({ id, name: `${id}.pdf`, size_bytes: 1, mime_type: "application/pdf", extension: "pdf", created_at: 1,
     updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0 }) as FileItem;

const page = (files: FileItem[], pageNum: number, totalPages: number): FileListPage =>
  ({ folders: [], files, breadcrumbs: [], pagination: { page: pageNum, per_page: 100, total_files: 0, total_pages: totalPages } });

afterEach(() => jest.clearAllMocks());

describe("trackTitle", () => {
  it("strips the final extension only", () => {
    expect(trackTitle("song.mp3")).toBe("song");
    expect(trackTitle("mix.final.m4a")).toBe("mix.final");
    expect(trackTitle("no-extension")).toBe("no-extension");
  });
});

describe("buildTracks", () => {
  it("keeps only unlocked audio, preserving order, and maps metadata", () => {
    const tracks = buildTracks([doc("d1"), audio("a1", "one.mp3"), audio("a2", "two.mp3", "full_lock"), audio("a3", "three.mp3")], "Road trip");
    expect(tracks.map((t) => t.fileId)).toEqual(["a1", "a3"]);
    expect(tracks[0]).toEqual({ fileId: "a1", title: "one", artist: "Road trip", extension: "mp3", sizeBytes: 1000, modifiedAt: 5 });
  });
});

describe("fetchAllAudioTracks", () => {
  const base = { workspaceId: "w1", folderId: "dir1", filter: "all" as const, sort: "newest" as const, sourceName: "Mix" };

  it("uses loaded pages without fetching when everything is already loaded", async () => {
    const res = await fetchAllAudioTracks({ ...base, loadedPages: [page([audio("a1", "a.mp3")], 1, 1)] });
    expect(res).toEqual({ tracks: buildTracks([audio("a1", "a.mp3")], "Mix"), truncated: false });
    expect(mockListFiles).not.toHaveBeenCalled();
  });

  it("fetches the remaining pages with the same filter and sort", async () => {
    mockListFiles.mockResolvedValueOnce(page([audio("a2", "b.mp3")], 2, 2));
    const res = await fetchAllAudioTracks({ ...base, loadedPages: [page([audio("a1", "a.mp3")], 1, 2)] });
    expect(mockListFiles).toHaveBeenCalledWith({ workspaceId: "w1", folderId: "dir1", filter: "all", sort: "newest", page: 2 });
    expect(res.tracks.map((t) => t.fileId)).toEqual(["a1", "a2"]);
  });

  it("caps at QUEUE_CAP and reports truncation without fetching every page", async () => {
    const big = Array.from({ length: QUEUE_CAP + 10 }, (_, i) => audio(`a${i}`, `t${i}.mp3`));
    const res = await fetchAllAudioTracks({ ...base, loadedPages: [page(big, 1, 50)] });
    expect(res.tracks).toHaveLength(QUEUE_CAP);
    expect(res.truncated).toBe(true);
    expect(mockListFiles).not.toHaveBeenCalled();
  });
});
