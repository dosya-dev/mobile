import { folderIconSource } from "./FolderIcon";

// The three assets are distinct modules; identity comparison is enough to prove the
// mapping without asserting on Metro's asset ids, which aren't stable.
const empty = folderIconSource({ file_count: 0, is_synced: 0 });
const full = folderIconSource({ file_count: 3, is_synced: 0 });
const synced = folderIconSource({ file_count: 0, is_synced: 1 });

describe("folderIconSource", () => {
  it("distinguishes empty, full and synced folders", () => {
    expect(empty).not.toBe(full);
    expect(synced).not.toBe(empty);
    expect(synced).not.toBe(full);
  });

  it("uses the full icon once a folder has anything in it", () => {
    expect(folderIconSource({ file_count: 1, is_synced: 0 })).toBe(full);
    expect(folderIconSource({ file_count: 0, is_synced: 0 })).toBe(empty);
  });

  it("keeps the synced icon on a backup folder regardless of contents", () => {
    // Matches web's folderIconSrc: the isSynced check returns before the count is read.
    expect(folderIconSource({ file_count: 9, is_synced: 1 })).toBe(synced);
  });
});
