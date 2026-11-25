const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));

import { getWatermark, advanceWatermark, clearWatermarks } from "./watermark";

beforeEach(() => mockMem.clear());

describe("scan watermarks", () => {
  it("starts empty and round-trips per workspace", async () => {
    expect(await getWatermark("w1")).toBeNull();
    await advanceWatermark("w1", 1710000000, { fullScan: true, now: 1710000500 });
    expect(await getWatermark("w1")).toEqual({ newestCreatedAt: 1710000000, lastFullScanAt: 1710000500 });
    expect(await getWatermark("w2")).toBeNull();
  });

  it("only moves forward, and an incremental advance keeps the reconcile clock", async () => {
    await advanceWatermark("w1", 1710000000, { fullScan: true, now: 1710000500 });
    await advanceWatermark("w1", 1709000000, { fullScan: false }); // older asset - must not regress
    expect((await getWatermark("w1"))!.newestCreatedAt).toBe(1710000000);
    expect((await getWatermark("w1"))!.lastFullScanAt).toBe(1710000500);
    await advanceWatermark("w1", 1720000000, { fullScan: false });
    expect((await getWatermark("w1"))!.newestCreatedAt).toBe(1720000000);
    expect((await getWatermark("w1"))!.lastFullScanAt).toBe(1710000500);
  });

  it("clearWatermarks wipes every workspace (account purge)", async () => {
    await advanceWatermark("w1", 1, { fullScan: true, now: 2 });
    await advanceWatermark("w2", 3, { fullScan: true, now: 4 });
    await clearWatermarks();
    expect(await getWatermark("w1")).toBeNull();
    expect(await getWatermark("w2")).toBeNull();
  });
});
