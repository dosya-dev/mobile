import { purgeTrashedFolder, describeFolderPurge, MAX_FOLDER_PURGE_CALLS, type PurgeResponse } from "./folderPurge";

/** A server that needs `passes` calls before it reports the folder empty. */
function server(passes: number, perPass = 100) {
  let call = 0;
  return jest.fn(async (): Promise<PurgeResponse> => {
    call += 1;
    const done = call >= passes;
    return {
      ok: true,
      permanent: true,
      complete: done,
      remaining: done ? 0 : (passes - call) * perPass,
      files_affected: perPass,
    };
  });
}

describe("purgeTrashedFolder", () => {
  it("keeps asking while the server says it is not finished, and sums the work", async () => {
    const purgeOnce = server(3);
    const outcome = await purgeTrashedFolder(purgeOnce);
    expect(purgeOnce).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ complete: true, filesAffected: 300, remaining: 0, calls: 3 });
  });

  it("returns after one call when the folder was emptied in a single pass", async () => {
    const purgeOnce = server(1);
    const outcome = await purgeTrashedFolder(purgeOnce);
    expect(purgeOnce).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ complete: true, filesAffected: 100 });
  });

  /**
   * The first delete of a folder that is not in the trash yet answers a plain
   * `{ ok: true }`. Treating a missing `complete` as unfinished would hammer
   * that endpoint fifty times for an ordinary move-to-trash.
   */
  it("treats a body with no `complete` field as finished", async () => {
    const purgeOnce = jest.fn(async () => ({ ok: true }) as PurgeResponse);
    const outcome = await purgeTrashedFolder(purgeOnce);
    expect(purgeOnce).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ complete: true, filesAffected: 0, remaining: 0, calls: 1 });
  });

  it("stops at the call cap and reports the folder as still emptying", async () => {
    const purgeOnce = server(1000, 10);
    const outcome = await purgeTrashedFolder(purgeOnce);
    expect(purgeOnce).toHaveBeenCalledTimes(MAX_FOLDER_PURGE_CALLS);
    expect(MAX_FOLDER_PURGE_CALLS).toBe(50);
    expect(outcome.complete).toBe(false);
    expect(outcome.calls).toBe(50);
    expect(outcome.filesAffected).toBe(500);
    expect(outcome.remaining).toBeGreaterThan(0);
  });

  it("honours a smaller cap", async () => {
    const purgeOnce = server(1000, 10);
    const outcome = await purgeTrashedFolder(purgeOnce, { maxCalls: 2 });
    expect(purgeOnce).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ complete: false, calls: 2, filesAffected: 20 });
  });

  /** A 403 or a 404 would be refused just as firmly fifty times over. */
  it("propagates a rejection instead of retrying it", async () => {
    const boom = new Error("You do not have permission to delete this folder");
    const purgeOnce = jest.fn()
      .mockResolvedValueOnce({ ok: true, complete: false, remaining: 5, files_affected: 5 })
      .mockRejectedValueOnce(boom);
    await expect(purgeTrashedFolder(purgeOnce)).rejects.toThrow(boom);
    expect(purgeOnce).toHaveBeenCalledTimes(2);
  });

  it("counts a pass that reported no numbers at all", async () => {
    const purgeOnce = jest.fn()
      .mockResolvedValueOnce({ ok: true, complete: false })
      .mockResolvedValueOnce({ ok: true, complete: true });
    const outcome = await purgeTrashedFolder(purgeOnce);
    expect(outcome).toEqual({ complete: true, filesAffected: 0, remaining: 0, calls: 2 });
  });
});

describe("describeFolderPurge", () => {
  it("reports a finished purge", () => {
    expect(describeFolderPurge({ complete: true, filesAffected: 0, remaining: 0, calls: 1 })).toBe("Deleted");
    expect(describeFolderPurge({ complete: true, filesAffected: 1, remaining: 0, calls: 1 })).toBe("Deleted - 1 file removed");
    expect(describeFolderPurge({ complete: true, filesAffected: 240, remaining: 0, calls: 3 })).toBe("Deleted - 240 files removed");
  });

  it("never calls an unfinished purge deleted, and says how to carry on", () => {
    const msg = describeFolderPurge({ complete: false, filesAffected: 500, remaining: 1200, calls: 50 });
    expect(msg).toMatch(/^Still emptying/);
    expect(msg).not.toMatch(/\bDeleted\b/);
    expect(msg).toContain("500 files removed so far");
    expect(msg).toContain("about 1200 to go");
    expect(msg).toContain("Delete it again to carry on.");
    expect(msg).not.toContain("—");
  });
});
