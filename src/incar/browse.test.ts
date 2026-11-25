import { listBrowseLevel } from "./browse";
import * as api from "@/files/api";

jest.mock("@/files/api");

const folder = (id: string, name: string) => ({
  id, name, created_at: 0, lock_mode: "none", file_count: 1, is_synced: 0, is_hidden: 0, hidden_mode: "none",
});
const file = (id: string, name: string, mime: string, ext: string | null, lock: string = "none") => ({
  id, name, size_bytes: 100, mime_type: mime, extension: ext, created_at: 0, updated_at: 0,
  current_version: 1, lock_mode: lock, share_count: 0, comment_count: 0,
});

describe("listBrowseLevel", () => {
  it("returns folders and audio-only files, dropping locked and non-audio entries", async () => {
    jest.spyOn(api, "listFiles").mockResolvedValue({
      folders: [folder("f1", "Podcasts")],
      files: [
        file("a1", "The Daily.mp3", "audio/mpeg", "mp3"),
        file("a2", "cover.jpg", "image/jpeg", "jpg"),
        file("a3", "locked.mp3", "audio/mpeg", "mp3", "full_lock"),
      ],
      breadcrumbs: [],
      pagination: { page: 1, per_page: 100, total_files: 3, total_pages: 1 },
    });

    const level = await listBrowseLevel("ws1", "folder1");

    expect(api.listFiles).toHaveBeenCalledWith({ workspaceId: "ws1", folderId: "folder1", perPage: 100 });
    expect(level.folders.map((f) => f.id)).toEqual(["f1"]);
    expect(level.audioFiles.map((f) => f.id)).toEqual(["a1"]);
  });

  it("passes folderId null for the workspace root", async () => {
    jest.spyOn(api, "listFiles").mockResolvedValue({
      folders: [], files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 },
    });
    await listBrowseLevel("ws1", null);
    expect(api.listFiles).toHaveBeenCalledWith({ workspaceId: "ws1", folderId: null, perPage: 100 });
  });
});
