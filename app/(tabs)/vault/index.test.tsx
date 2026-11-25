// The real Vault store, with the engine and the file-system modules behind it
// replaced (same mock set as src/vault/store.test.ts): the screen's whole job
// is to drive that store, so the store is what these tests drive.
// `mock`-prefixed so babel-plugin-jest-hoist lets the hoisted factory close
// over it; the map itself is only ever touched from inside the functions,
// which run long after this module body has finished.
const mockKeychain = new Map<string, string>();
jest.mock("@/lib/keychain", () => ({
  getItem: async (k: string) => mockKeychain.get(k) ?? null,
  setItem: async (k: string, v: string) => { mockKeychain.set(k, v); },
  deleteItem: async (k: string) => { mockKeychain.delete(k); },
}));
jest.mock("@/vault/engine", () => ({ createVaultEngine: () => ({}) }));
jest.mock("@/vault/cache", () => ({
  cachePathFor: () => ({ dir: "/c", fileName: "f" }),
  cachedFile: async () => null,
  createCacheSink: () => ({ sink: async () => {}, finish: async () => "/c/f", abort: async () => {} }),
  wipeVaultCache: async () => {},
}));
jest.mock("@/vault/fileSource", () => ({ fileSourceFromUri: async () => ({ totalSize: 0, boundaries: [], read: async () => new Uint8Array(0), close: () => {} }) }));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }));
// The workspace context bar needs a query client and secure store; its own
// suite covers it.
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));

import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import VaultScreen from "./index";
import { useVault, type KnownSpace } from "@/vault/store";
import type { VaultEngine } from "@/vault/engine";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useTabBarHolds } from "@/orbit/tabBarHold";

const GATE_COPY =
  "Your files are encrypted on this phone before they ever leave it. dosya only ever stores ciphertext.";

type Calls = string[];
function fakeEngine(over: Partial<VaultEngine> = {}): VaultEngine & { calls: Calls } {
  const calls: Calls = [];
  return {
    calls,
    hasIdentity: async () => { calls.push("hasIdentity"); return true; },
    setup: async () => ({ recoveryKeyHex: "deadbeef" }),
    unlock: async () => {},
    unlockWithRecoveryKey: async () => {},
    lock: () => { calls.push("lock"); },
    isUnlocked: () => true,
    createWorkspace: async (id: string) => { calls.push(`create:${id}`); },
    setWorkspaceScope: async () => {},
    openWorkspace: async (id: string) => { calls.push(`open:${id}`); },
    listMyWorkspaces: async () => { calls.push("listMyWorkspaces"); return []; },
    listFolder: async () => [],
    createFolder: async () => ({ folderId: "d1" }),
    uploadFile: async () => ({ fileId: "f1" }),
    downloadFileTo: async () => ({ totalSize: 0 }),
    deleteEntry: async () => {},
    ...over,
  } as unknown as VaultEngine & { calls: Calls };
}

const space = (over: Partial<KnownSpace> = {}): KnownSpace => ({
  id: "ws-1", name: "Photos", selfFounded: true, globalWorkspaceId: "gw-1", shared: false, ...over,
});

let engine: ReturnType<typeof fakeEngine>;

function resetVault(over: Partial<ReturnType<typeof useVault.getState>> = {}): void {
  useVault.setState({ status: "locked", hasIdentity: null, error: null, busy: false, spaces: [], activeSpaceId: null, entries: [], recoveryKeyOnce: null, transfers: {}, ...over });
  // The screen re-hydrates the list from the keychain on mount, so a preset
  // that only lived in the store would be wiped a microtask later - which is
  // exactly what the real screen does to a stale in-memory list.
  if (over.spaces) mockKeychain.set("dosya.vault.workspaces.u1", JSON.stringify(over.spaces));
  useVault.getState().__setEngine(engine);
}

beforeEach(() => {
  mockKeychain.clear();
  mockPush.mockClear();
  mockNavigate.mockClear();
  useTabBarHolds.setState({ holds: [] });
  engine = fakeEngine();
  resetVault();
  useWorkspaceStore.setState({ activeId: "gw-1", hydrated: true });
  useAuthStore.setState({ status: "signedIn", user: { id: "u1", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null });
  jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
});

afterEach(() => jest.restoreAllMocks());

describe("Vault screen: the gate", () => {
  it("reads this account's Spaces list and then checks for an identity", async () => {
    mockKeychain.set("dosya.vault.workspaces.u1", JSON.stringify([space()]));
    engine = fakeEngine({ hasIdentity: async () => true });
    resetVault({ status: "unlocked", hasIdentity: true });

    render(<VaultScreen />);

    // The list could only have come from THIS account's keychain entry, which
    // is what hydrate(accountId) reads.
    await waitFor(() => expect(screen.getByTestId("space-row-ws-1")).toBeTruthy());
  });

  it("shows a spinner while the identity check is still out", async () => {
    let settle: (v: boolean) => void = () => {};
    let asked = false;
    engine = fakeEngine({ hasIdentity: () => { asked = true; return new Promise<boolean>((r) => { settle = r; }); } });
    resetVault();

    render(<VaultScreen />);

    expect(screen.getByTestId("vault-checking")).toBeTruthy();
    // The check only starts once the keychain read before it has come back.
    await waitFor(() => expect(asked).toBe(true));
    // Resolved inside act so the re-render is flushed here rather than being
    // raced against a timeout on a loaded machine.
    await act(async () => { settle(true); });
    expect(screen.queryByTestId("vault-checking")).toBeNull();
  });

  it("offers a retry - never Setup - when the check itself failed", async () => {
    let fail = true;
    engine = fakeEngine({ hasIdentity: async () => { if (fail) throw new Error("offline"); return true; } });
    resetVault();

    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByText("Could not check encryption status.")).toBeTruthy());
    // A failed check must never route a returning user into Setup, whose
    // upsert would orphan their real Spaces.
    expect(screen.queryByTestId("vault-setup-submit")).toBeNull();

    fail = false;
    fireEvent.press(screen.getByTestId("vault-retry"));
    await waitFor(() => expect(screen.getByTestId("vault-unlock-submit")).toBeTruthy());
  });

  it("opens with the intro when this account has no Vault yet, then asks for a passphrase", async () => {
    engine = fakeEngine({ hasIdentity: async () => false });
    resetVault();

    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-intro")).toBeTruthy());
    expect(screen.queryByTestId("vault-unlock-submit")).toBeNull();

    fireEvent.press(screen.getByTestId("vault-intro-skip"));
    await waitFor(() => expect(screen.getByTestId("vault-setup-submit")).toBeTruthy());
    // Skipping counts as having seen it.
    await waitFor(() => expect(mockKeychain.get("dosya.vault.introSeen")).toBe("1"));
  });

  it("asks to unlock when there is an identity but no session", async () => {
    render(<VaultScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-unlock-submit")).toBeTruthy());
    expect(screen.queryByText(GATE_COPY)).toBeNull();
  });
});

describe("Vault screen: first run", () => {
  beforeEach(() => {
    engine = fakeEngine({ hasIdentity: async () => false });
    resetVault();
  });

  it("goes straight to the passphrase on a phone that has seen the intro", async () => {
    mockKeychain.set("dosya.vault.introSeen", "1");
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-setup-submit")).toBeTruthy());
    expect(screen.queryByTestId("vault-intro")).toBeNull();
  });

  it("steps through the slides to setup, and back again", async () => {
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-intro-next")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-intro-next"));
    fireEvent.press(screen.getByTestId("vault-intro-next"));
    // The last slide trades Next and Skip for the two real choices.
    expect(screen.queryByTestId("vault-intro-next")).toBeNull();
    expect(screen.queryByTestId("vault-intro-skip")).toBeNull();

    fireEvent.press(screen.getByTestId("vault-intro-setup"));
    await waitFor(() => expect(screen.getByTestId("vault-setup")).toBeTruthy());

    // Back from the passphrase lands on the last slide, not the first.
    fireEvent.press(screen.getByTestId("onboarding-back"));
    await waitFor(() => expect(screen.getByTestId("vault-intro-setup")).toBeTruthy());
  });

  it("leaves for Files on Not now, without marking the intro seen", async () => {
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-intro-next")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-intro-next"));
    fireEvent.press(screen.getByTestId("vault-intro-next"));
    fireEvent.press(screen.getByTestId("vault-intro-not-now"));

    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(mockKeychain.has("dosya.vault.introSeen")).toBe(false);
  });

  it("holds the tab bar away for the whole walkthrough", async () => {
    render(<VaultScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-intro")).toBeTruthy());
    expect(useTabBarHolds.getState().holds).toEqual(["vault-onboarding"]);
  });

  it("creates the Vault, shows the key once, and ends on the ready page", async () => {
    mockKeychain.set("dosya.vault.introSeen", "1");
    engine = fakeEngine({ hasIdentity: async () => false, setup: async () => ({ recoveryKeyHex: "3f9a1c7e8b20d45f" }) } as never);
    resetVault();
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-setup-pass")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("vault-setup-pass"), "maple orbit candle river");
    fireEvent.changeText(screen.getByTestId("vault-setup-confirm"), "maple orbit candle river");
    fireEvent.press(screen.getByTestId("vault-setup-submit"));

    await waitFor(() => expect(screen.getByTestId("vault-recovery-key-value")).toBeTruthy());
    expect(screen.getByText("3f9a")).toBeTruthy();

    fireEvent.press(screen.getByTestId("vault-recovery-stored"));
    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    await waitFor(() => expect(screen.getByTestId("vault-ready")).toBeTruthy());
    expect(useVault.getState().recoveryKeyOnce).toBeNull();

    fireEvent.press(screen.getByTestId("vault-ready-done"));
    await waitFor(() => expect(screen.getByTestId("vault-new-space")).toBeTruthy());
    // Out of the walkthrough, the bar comes back.
    expect(useTabBarHolds.getState().holds).toEqual([]);
  });

  it("opens the New Space dialog from the ready page", async () => {
    // Just set up: the server now has the identity.
    engine = fakeEngine();
    resetVault({ status: "unlocked", hasIdentity: true, recoveryKeyOnce: "3f9a1c7e" });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-recovery-stored")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-recovery-stored"));
    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    await waitFor(() => expect(screen.getByTestId("vault-ready-create")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-ready-create"));
    await waitFor(() => expect(screen.getByTestId("prompt-input")).toBeTruthy());
  });
});

describe("Vault screen: the Spaces view", () => {
  it("says what the Vault does, in the one sentence agreed for it, and links to the explainer", async () => {
    resetVault({ status: "unlocked", hasIdentity: true });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByText(GATE_COPY)).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-what-is"));
    expect(Linking.openURL).toHaveBeenCalledWith("https://dosya.dev/vault");
  });

  it("lists this workspace's own Spaces, and says so when there are none", async () => {
    resetVault({ status: "unlocked", hasIdentity: true });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByText("No Spaces yet in this workspace.")).toBeTruthy());
    expect(screen.getByText("My Spaces")).toBeTruthy();
    // Nothing is shared, so that section is not there at all.
    expect(screen.queryByText("Shared with me")).toBeNull();
  });

  it("keeps another workspace's Spaces out of My Spaces", async () => {
    resetVault({ status: "unlocked", hasIdentity: true, spaces: [space(), space({ id: "ws-2", name: "Elsewhere", globalWorkspaceId: "gw-2" })] });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("space-row-ws-1")).toBeTruthy());
    expect(screen.queryByTestId("space-row-ws-2")).toBeNull();
  });

  it("adds a Shared with me section only once something is actually shared", async () => {
    resetVault({ status: "unlocked", hasIdentity: true, spaces: [space({ id: "ws-9", name: "Team photos", shared: true, selfFounded: false })] });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByText("Shared with me")).toBeTruthy());
    expect(screen.getByTestId("space-row-ws-9")).toBeTruthy();
  });

  it("creates a Space and opens it at its root", async () => {
    resetVault({ status: "unlocked", hasIdentity: true });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-new-space")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-new-space"));
    fireEvent.changeText(screen.getByTestId("prompt-input"), "Holiday");
    fireEvent.press(screen.getByTestId("submit"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const id = useVault.getState().spaces[0].id;
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/vault/space/[id]/[folderId]",
      params: { id, folderId: "root", name: "Holiday" },
    });
  });

  it("does not navigate when the Space could not be created", async () => {
    engine = fakeEngine({ createWorkspace: async () => { throw new Error("no"); } });
    resetVault({ status: "unlocked", hasIdentity: true });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-new-space")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-new-space"));
    fireEvent.changeText(screen.getByTestId("prompt-input"), "Holiday");
    fireEvent.press(screen.getByTestId("submit"));

    await waitFor(() => expect(screen.getByText("Couldn't create the Space.")).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("opens a Space in the engine before navigating into it", async () => {
    resetVault({ status: "unlocked", hasIdentity: true, spaces: [space()] });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("space-row-ws-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("space-row-ws-1"));

    await waitFor(() => expect(engine.calls).toContain("open:ws-1"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/vault/space/[id]/[folderId]",
      params: { id: "ws-1", folderId: "root", name: "Photos" },
    });
  });

  it("stays put when the Space would not open", async () => {
    engine = fakeEngine({ openWorkspace: async () => { throw new Error("no"); } });
    resetVault({ status: "unlocked", hasIdentity: true, spaces: [space()] });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("space-row-ws-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("space-row-ws-1"));

    await waitFor(() => expect(screen.getByText("Couldn't open the Space.")).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("locks the Vault from the list", async () => {
    resetVault({ status: "unlocked", hasIdentity: true, spaces: [space()] });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-lock")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-lock"));

    await waitFor(() => expect(useVault.getState().status).toBe("locked"));
    expect(engine.calls).toContain("lock");
  });

  it("checks for Spaces once per unlocked session, not on every render", async () => {
    resetVault({ status: "unlocked", hasIdentity: true });
    const { rerender } = render(<VaultScreen />);

    await waitFor(() => expect(engine.calls.filter((c) => c === "listMyWorkspaces")).toHaveLength(1));
    rerender(<VaultScreen />);
    expect(engine.calls.filter((c) => c === "listMyWorkspaces")).toHaveLength(1);
  });

  it("puts the recovery key in front of the Spaces until it has been saved", async () => {
    resetVault({ status: "unlocked", hasIdentity: true, spaces: [space()], recoveryKeyOnce: "4f2a 91bc" });
    render(<VaultScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-recovery-key-value")).toBeTruthy());
    expect(screen.queryByTestId("space-row-ws-1")).toBeNull();

    // Finish stays off until the person says the key is stored.
    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    expect(screen.getByTestId("vault-recovery-key-value")).toBeTruthy();

    fireEvent.press(screen.getByTestId("vault-recovery-stored"));
    fireEvent.press(screen.getByTestId("vault-recovery-dismiss"));
    await waitFor(() => expect(screen.getByTestId("vault-ready-done")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-ready-done"));
    await waitFor(() => expect(screen.getByTestId("space-row-ws-1")).toBeTruthy());
  });
});
