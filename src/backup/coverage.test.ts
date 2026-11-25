import { deriveCoverage } from "./coverage";

const counts = (o: Partial<Record<"pending" | "queued" | "uploaded" | "skipped_large" | "error", number>>) => ({
  pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 0, ...o,
});

describe("deriveCoverage", () => {
  it("counts down from the library, not from the rows the scan has reached", () => {
    // A 7,000-item library where the throttled scan has only materialised ~200
    // rows so far: the ledger's own pending is useless as a "left to do" number.
    const c = deriveCoverage(counts({ uploaded: 150, pending: 120 }), 7000);
    expect(c).toEqual({ uploaded: 150, pending: 6850, total: 7000 });
  });

  it("removes permanently-settled items from pending", () => {
    const c = deriveCoverage(counts({ uploaded: 10, skipped_large: 3, error: 2 }), 100);
    expect(c.pending).toBe(85);
  });

  it("never reports more backed up than the library holds", () => {
    // Photos deleted from the device after backup keep their uploaded row.
    const c = deriveCoverage(counts({ uploaded: 120 }), 100);
    expect(c).toEqual({ uploaded: 100, pending: 0, total: 100 });
  });

  it("falls back to the ledger when the library cannot be counted", () => {
    // No photo permission: countLibraryAssets answers null.
    const c = deriveCoverage(counts({ uploaded: 5, pending: 2 }), null);
    expect(c).toEqual({ uploaded: 5, pending: 2, total: null });
  });

  it("treats an empty library as nothing to do, whatever the ledger says", () => {
    const c = deriveCoverage(counts({ pending: 4 }), 0);
    expect(c).toEqual({ uploaded: 0, pending: 0, total: 0 });
  });

  it("counts queued items as still pending", () => {
    const c = deriveCoverage({ pending: 10, queued: 5, uploaded: 20, skipped_large: 0, error: 0 }, 100);
    expect(c.pending).toBe(80);
    const fb = deriveCoverage({ pending: 10, queued: 5, uploaded: 20, skipped_large: 0, error: 0 }, null);
    expect(fb.pending).toBe(15);
  });
});
