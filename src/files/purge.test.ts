import { purgeSequence, describePurgeReport } from "./purge";

describe("purgeSequence", () => {
  it("returns an empty report for no ids without calling the deleter", async () => {
    const deleteOne = jest.fn();
    const report = await purgeSequence([], deleteOne);
    expect(report).toEqual({ outcomes: [], succeeded: [], failed: [] });
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("deletes every id and reports them all as succeeded", async () => {
    const seen: string[] = [];
    const report = await purgeSequence(["a", "b", "c"], async (id) => { seen.push(id); });
    expect(seen.sort()).toEqual(["a", "b", "c"]);
    expect(report.succeeded.sort()).toEqual(["a", "b", "c"]);
    expect(report.failed).toEqual([]);
  });

  it("keeps going after a failure rather than stranding the rest of the trash", async () => {
    const report = await purgeSequence(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("locked");
    });
    expect(report.succeeded.sort()).toEqual(["a", "c"]);
    expect(report.failed).toEqual(["b"]);
    expect(report.outcomes.find((o) => o.id === "b")!.error).toBe("locked");
  });

  it("never exceeds the concurrency ceiling", async () => {
    let inFlight = 0;
    let peak = 0;
    await purgeSequence(
      Array.from({ length: 20 }, (_, i) => `id${i}`),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
      { concurrency: 4 },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("defaults to a concurrency of 4 so a phone does not open 200 sockets", async () => {
    let inFlight = 0;
    let peak = 0;
    await purgeSequence(
      Array.from({ length: 12 }, (_, i) => `id${i}`),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("preserves outcome order matching the input order", async () => {
    const report = await purgeSequence(["a", "b", "c"], async () => {});
    expect(report.outcomes.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("reports a non-Error rejection without crashing", async () => {
    const report = await purgeSequence(["a"], async () => { throw "plain string"; });
    expect(report.failed).toEqual(["a"]);
    expect(report.outcomes[0].error).toBe("plain string");
  });
});

describe("describePurgeReport", () => {
  it("does not claim a clean sweep when some items failed", () => {
    expect(describePurgeReport({ outcomes: [], succeeded: ["a", "b"], failed: ["c"] }))
      .toBe("2 deleted, 1 could not be deleted");
  });

  it("uses singular wording for one item", () => {
    expect(describePurgeReport({ outcomes: [], succeeded: ["a"], failed: [] }))
      .toBe("1 item deleted");
  });

  it("reports a clean sweep plainly", () => {
    expect(describePurgeReport({ outcomes: [], succeeded: ["a", "b"], failed: [] }))
      .toBe("2 items deleted");
  });

  it("reports total failure without implying success", () => {
    expect(describePurgeReport({ outcomes: [], succeeded: [], failed: ["a"] }))
      .toBe("Nothing was deleted, 1 failed");
  });
});
