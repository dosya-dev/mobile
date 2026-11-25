const mockDeleteAssetsAsync = jest.fn(async (..._a: unknown[]) => true);
jest.mock("expo-media-library", () => ({ deleteAssetsAsync: (...a: any[]) => mockDeleteAssetsAsync(...a) }));
const mockListReclaimable = jest.fn(async (..._a: unknown[]) => [] as unknown[]);
jest.mock("./ledger", () => ({ listReclaimable: (...a: unknown[]) => mockListReclaimable(...a) }));
const mockCheckFingerprints = jest.fn(async (..._a: unknown[]) => ({}) as Record<string, string>);
jest.mock("./api", () => ({ checkFingerprints: (...a: unknown[]) => mockCheckFingerprints(...a) }));

import { buildReclaimPlan, runReclaim } from "./reclaim";

const row = (over: Record<string, unknown>) => ({
  workspace_id: "w1", local_id: "a", filename: "a.jpg", size: 100, created_at: 1,
  fingerprint: "fp-a", status: "uploaded", remote_file_id: "f1", attempts: 0,
  last_error: null, mp_session: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListReclaimable.mockResolvedValue([]);
  mockCheckFingerprints.mockResolvedValue({});
});

describe("buildReclaimPlan", () => {
  it("only offers assets the server still confirms it holds", async () => {
    mockListReclaimable.mockResolvedValue([
      row({ local_id: "a", fingerprint: "fp-a", size: 100 }),
      row({ local_id: "b", fingerprint: "fp-b", size: 200 }),
    ]);
    // The server no longer holds fp-b - the user may have deleted it from the
    // web app since it was backed up.
    mockCheckFingerprints.mockResolvedValue({ "fp-a": "f1" });
    const plan = await buildReclaimPlan("w1");
    expect(plan.ids).toEqual(["a"]);
    expect(plan.bytes).toBe(100);
    expect(plan.unverifiable).toBe(1);
  });

  it("counts rows with no fingerprint as unverifiable rather than deleting them", async () => {
    mockListReclaimable.mockResolvedValue([row({ fingerprint: null })]);
    const plan = await buildReclaimPlan("w1");
    // There is no in-app restore, so local bookkeeping alone is not enough to
    // justify removing someone's only copy.
    expect(plan.ids).toEqual([]);
    expect(plan.unverifiable).toBe(1);
  });

  it("sums the reclaimable bytes across everything confirmed", async () => {
    mockListReclaimable.mockResolvedValue([
      row({ local_id: "a", fingerprint: "fp-a", size: 100 }),
      row({ local_id: "b", fingerprint: "fp-b", size: 250 }),
    ]);
    mockCheckFingerprints.mockResolvedValue({ "fp-a": "f1", "fp-b": "f2" });
    const plan = await buildReclaimPlan("w1");
    expect(plan.bytes).toBe(350);
    expect(plan.unverifiable).toBe(0);
  });

  it("asks the server about each distinct fingerprint once", async () => {
    mockListReclaimable.mockResolvedValue([
      row({ local_id: "a", fingerprint: "same" }),
      row({ local_id: "b", fingerprint: "same" }),
    ]);
    mockCheckFingerprints.mockResolvedValue({ same: "f1" });
    await buildReclaimPlan("w1");
    expect(mockCheckFingerprints).toHaveBeenCalledWith("w1", ["same"]);
  });

  it("offers nothing when the ledger has nothing backed up", async () => {
    const plan = await buildReclaimPlan("w1");
    expect(plan).toEqual({ ids: [], bytes: 0, unverifiable: 0 });
    expect(mockCheckFingerprints).not.toHaveBeenCalled();
  });

  it("offers nothing when the verification call fails", async () => {
    mockListReclaimable.mockResolvedValue([row({})]);
    mockCheckFingerprints.mockRejectedValue(new Error("offline"));
    // Failing closed: unverified means untouched.
    const plan = await buildReclaimPlan("w1");
    expect(plan.ids).toEqual([]);
    expect(plan.unverifiable).toBe(1);
  });
});

describe("runReclaim", () => {
  it("deletes the whole plan in a single call", async () => {
    await expect(runReclaim({ ids: ["a", "b", "c"], bytes: 300, unverifiable: 0 })).resolves.toBe(3);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("deletes nothing when the plan is empty", async () => {
    await expect(runReclaim({ ids: [], bytes: 0, unverifiable: 4 })).resolves.toBe(0);
    expect(mockDeleteAssetsAsync).not.toHaveBeenCalled();
  });

  it("reports zero removed when the user declines the OS prompt", async () => {
    mockDeleteAssetsAsync.mockRejectedValue(new Error("denied"));
    await expect(runReclaim({ ids: ["a"], bytes: 1, unverifiable: 0 })).resolves.toBe(0);
  });
});
