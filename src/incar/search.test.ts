import { searchAudio } from "./search";
import * as api from "@/files/api";

jest.mock("@/files/api");

describe("searchAudio", () => {
  it("filters results to audio files, folders pass through unfiltered", async () => {
    jest.spyOn(api, "search").mockResolvedValue({
      files: [
        { id: "a1", name: "Nvidia Pt 2.mp3", size_bytes: 1, mime_type: "audio/mpeg", extension: "mp3", created_at: 0, updated_at: 0, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0 },
        { id: "a2", name: "notes.pdf", size_bytes: 1, mime_type: "application/pdf", extension: "pdf", created_at: 0, updated_at: 0, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0 },
      ],
      folders: [{ id: "f1", name: "Nvidia Earnings", created_at: 0, lock_mode: "none", file_count: 1, is_synced: 0, is_hidden: 0, hidden_mode: "none" }],
    });

    const results = await searchAudio("ws1", "nvidia");

    expect(api.search).toHaveBeenCalledWith("ws1", "nvidia");
    expect(results.files.map((f) => f.id)).toEqual(["a1"]);
    expect(results.folders.map((f) => f.id)).toEqual(["f1"]);
  });
});
