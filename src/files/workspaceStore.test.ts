const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; useWorkspaceStore.setState({ activeId: null }); });

describe("workspaceStore", () => {
  it("hydrate reads the persisted active id", async () => {
    store["dosya.workspace"] = "w9";
    await useWorkspaceStore.getState().hydrate();
    expect(useWorkspaceStore.getState().activeId).toBe("w9");
  });
  it("setActive persists and updates", async () => {
    await useWorkspaceStore.getState().setActive("w1");
    expect(useWorkspaceStore.getState().activeId).toBe("w1");
    expect(store["dosya.workspace"]).toBe("w1");
  });
});

describe("reset", () => {
  it("clears the active workspace and its persisted key (account purge)", async () => {
    await useWorkspaceStore.getState().setActive("w9");
    await useWorkspaceStore.getState().reset();
    expect(useWorkspaceStore.getState().activeId).toBeNull();
    await useWorkspaceStore.getState().hydrate();
    expect(useWorkspaceStore.getState().activeId).toBeNull();
  });
});

// The auto-pick race: WorkspaceGate/WorkspaceSwitcher select workspaces[0]
// whenever activeId is null - and on boot activeId IS null until the async
// SecureStore read lands. When the workspaces fetch won that race, the gate
// overwrote the user's persisted choice with the server's first workspace
// (observed on-device: the phone silently switched to an empty workspace).
// `hydrated` is the fence: pickers may only act once it is true.
it("exposes hydrated=false until the persisted read completes", async () => {
  useWorkspaceStore.setState({ activeId: null, hydrated: false });
  expect(useWorkspaceStore.getState().hydrated).toBe(false);
  await useWorkspaceStore.getState().hydrate();
  expect(useWorkspaceStore.getState().hydrated).toBe(true);
});
