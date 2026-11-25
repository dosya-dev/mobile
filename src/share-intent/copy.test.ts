jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  copyAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 1400 })),
  deleteAsync: jest.fn(async () => {}),
}));

import * as FS from "expo-file-system/legacy";
import { toUploadDrafts } from "./copy";
import type { SharedFile } from "./types";

const pdf: SharedFile = {
  uri: "content://com.android.providers.downloads/document/42",
  name: "invoice-2026.pdf",
  size: 1400,
  mime: "application/pdf",
};

beforeEach(() => jest.clearAllMocks());

describe("toUploadDrafts", () => {
  it("copies the content:// URI into the cache and uploads the copy, not the original", async () => {
    // The whole point. A content:// grant dies with the granting task, but the
    // upload queue is persisted and retried across app restarts - so enqueueing
    // the original URI produces an upload that fails forever after the first
    // restart, with no way for the user to tell why.
    const { drafts } = await toUploadDrafts([pdf]);

    expect(FS.copyAsync).toHaveBeenCalledWith(
      expect.objectContaining({ from: pdf.uri, to: expect.stringContaining("file:///cache/") }),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].uri).not.toBe(pdf.uri);
    expect(drafts[0].uri).toContain("file:///cache/");
  });

  it("keeps the display name the provider reported, not the cache filename", async () => {
    // The cache copy needs a collision-proof name, but that name must not reach
    // the server - the user shared "invoice-2026.pdf" and that is what belongs
    // in their file list.
    const { drafts } = await toUploadDrafts([pdf]);
    expect(drafts[0].name).toBe("invoice-2026.pdf");
    expect(drafts[0].uri).not.toContain("invoice-2026.pdf");
  });

  it("names the cache copy so the existing upload- sweeper reclaims it", async () => {
    // sweepUploadCache() deletes cacheDirectory entries starting with "upload-".
    // A different prefix would leak a full copy of every shared file, forever.
    const { drafts } = await toUploadDrafts([pdf]);
    expect(drafts[0].uri.replace("file:///cache/", "")).toMatch(/^upload-/);
  });

  it("gives each file a distinct id and cache path", async () => {
    const { drafts } = await toUploadDrafts([pdf, { ...pdf, name: "b.pdf" }]);
    expect(drafts[0].id).not.toBe(drafts[1].id);
    expect(drafts[0].uri).not.toBe(drafts[1].uri);
  });

  it("trusts the copied file's real size over the size the provider claimed", async () => {
    // Some providers report SIZE as 0 or omit it. A 0 here bypasses the >50MB
    // resumable guard in the runner and records size_bytes: 0 on the server.
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false, size: 987 });
    const { drafts } = await toUploadDrafts([{ ...pdf, size: 0 }]);
    expect(drafts[0].size).toBe(987);
  });

  it("uploads the files it could copy and reports the ones it could not", async () => {
    // Partial failure is realistic: one revoked grant among several files. Failing
    // the whole batch would punish the user for the provider's behaviour, and
    // dropping it silently would look like a successful upload of everything.
    (FS.copyAsync as jest.Mock)
      .mockRejectedValueOnce(new Error("EPERM"))
      .mockResolvedValueOnce(undefined);

    const { drafts, failed } = await toUploadDrafts([{ ...pdf, name: "bad.pdf" }, { ...pdf, name: "good.pdf" }]);

    expect(drafts.map((d) => d.name)).toEqual(["good.pdf"]);
    expect(failed).toEqual(["bad.pdf"]);
  });

  it("deletes the iOS Inbox original once the copy exists", async () => {
    // iOS drops opened documents into Documents/Inbox and leaves deletion to
    // the app. The cache copy is what uploads; keeping the original as well
    // doubles the disk cost of every file and never gets reclaimed.
    const inbox = "file:///private/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/invoice.pdf";
    const { drafts } = await toUploadDrafts([{ ...pdf, uri: inbox }]);
    expect(drafts).toHaveLength(1);
    expect(FS.deleteAsync).toHaveBeenCalledWith(inbox, { idempotent: true });
  });

  it("never deletes an Android content:// source", async () => {
    // That URI belongs to another app's provider. Deleting through it would
    // remove the user's original from Downloads, not a temp copy of ours.
    await toUploadDrafts([pdf]);
    expect(FS.deleteAsync).not.toHaveBeenCalled();
  });

  it("still produces the draft when the Inbox delete fails", async () => {
    (FS.deleteAsync as jest.Mock).mockRejectedValueOnce(new Error("EPERM"));
    const inbox = "file:///private/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/a.pdf";
    const { drafts, failed } = await toUploadDrafts([{ ...pdf, uri: inbox }]);
    expect(drafts).toHaveLength(1);
    expect(failed).toEqual([]);
  });

  it("starts every draft unassigned so the caller must choose a destination", async () => {
    // folderId/workspaceId are stamped by the save-to screen. Defaulting them
    // here would drop shared files into whatever workspace happened to be
    // active, which is exactly the bug the picker exists to prevent.
    const { drafts } = await toUploadDrafts([pdf]);
    expect(drafts[0].folderId).toBeNull();
    expect(drafts[0].status).toBe("queued");
    expect(drafts[0].progress).toBe(0);
  });
});
