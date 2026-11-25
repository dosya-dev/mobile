import { renameFile, moveFile, deleteFile, batchDelete, createFolder, addFavourite, removeFavourite, restoreVersion, unlockFile } from "./mutations";

function capture() {
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return { status: 200, ok: true, headers: new Headers(), json: async () => ({ ok: true, unlock_token: "ut_1", id: "fav_1" }) };
  });
  return calls;
}

describe("mutations", () => {
  afterEach(() => jest.restoreAllMocks());

  it("renames with PUT + name body", async () => {
    const calls = capture();
    await renameFile("f1", "new.txt");
    expect(calls[0].url).toContain("/api/files/f1/rename");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual({ name: "new.txt" });
  });

  it("moves with folder_id (null for root)", async () => {
    const calls = capture();
    await moveFile("f1", null);
    expect(JSON.parse(calls[0].init.body)).toEqual({ folder_id: null });
  });

  it("deletes with DELETE", async () => {
    const calls = capture();
    await deleteFile("f1");
    expect(calls[0].url).toContain("/api/files/f1");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("batch-deletes with POST + workspace_id + file_ids", async () => {
    const calls = capture();
    await batchDelete(["a", "b"], "w1");
    expect(calls[0].url).toContain("/api/files/batch-delete");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ workspace_id: "w1", file_ids: ["a", "b"] });
  });

  it("creates a folder", async () => {
    const calls = capture();
    await createFolder("w1", null, "Docs");
    expect(JSON.parse(calls[0].init.body)).toEqual({ workspace_id: "w1", parent_id: null, name: "Docs" });
  });

  it("adds and removes a favourite", async () => {
    const calls = capture();
    await addFavourite("w1", { fileId: "f1" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ workspace_id: "w1", file_id: "f1" });
    await removeFavourite("w1", { fileId: "f1" });
    expect(calls[1].init.method).toBe("DELETE");
    expect(calls[1].url).toContain("file_id=f1");
  });

  it("restores a version", async () => {
    const calls = capture();
    await restoreVersion("f1", 3);
    expect(calls[0].url).toContain("/api/files/f1/versions/restore");
    expect(JSON.parse(calls[0].init.body)).toEqual({ version_number: 3 });
  });

  it("unlocks and returns the token", async () => {
    capture();
    const token = await unlockFile("f1", "hunter2");
    expect(token).toBe("ut_1");
  });
});
