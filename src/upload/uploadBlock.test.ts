const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));

import { useUploadBlock, hydrateUploadBlock, __resetUploadBlockHydration } from "./uploadBlock";

beforeEach(() => {
  mockMem.clear();
  useUploadBlock.setState({ reason: null });
  __resetUploadBlockHydration();
});

describe("upload block persistence", () => {
  it("persists a fatal reason and restores it on hydrate (app restart)", async () => {
    useUploadBlock.getState().setReason("Storage limit reached.");
    // Simulate a fresh process: in-memory state gone, hydration not yet run.
    useUploadBlock.setState({ reason: null });
    __resetUploadBlockHydration();
    await hydrateUploadBlock();
    expect(useUploadBlock.getState().reason).toBe("Storage limit reached.");
  });

  it("clearing the reason (manual retry) deletes the persisted value", async () => {
    useUploadBlock.getState().setReason("Storage limit reached.");
    useUploadBlock.getState().setReason(null);
    __resetUploadBlockHydration();
    await hydrateUploadBlock();
    expect(useUploadBlock.getState().reason).toBeNull();
  });

  it("hydrate with nothing stored keeps null", async () => {
    await hydrateUploadBlock();
    expect(useUploadBlock.getState().reason).toBeNull();
  });

  it("hydrate does not clobber a reason set earlier in this session", async () => {
    useUploadBlock.getState().setReason("Storage limit reached.");
    await hydrateUploadBlock();
    expect(useUploadBlock.getState().reason).toBe("Storage limit reached.");
  });
});
