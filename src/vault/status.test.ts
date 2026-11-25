jest.mock("@/lib/keychain", () => {
  const m = new Map<string, string>();
  return { getItem: async (k: string) => m.get(k) ?? null, __map: m };
});

import { readFileSync } from "fs";
import { join } from "path";
import { act, renderHook } from "@testing-library/react-native";
import {
  NO_VAULT_ACTIVITY,
  countKnownSpaces,
  getVaultActivity,
  isVaultLocked,
  setVaultActivity,
  setVaultLocked,
  useVaultActivity,
  useVaultLocked,
} from "./status";

const src = (...parts: string[]) => readFileSync(join(__dirname, "..", "..", ...parts), "utf8");

afterEach(() => {
  setVaultActivity(NO_VAULT_ACTIVITY);
  setVaultLocked(true);
});

describe("what the outside is told about the Vault", () => {
  it("starts locked, because a process that has never opened the Vault has no session", () => {
    expect(isVaultLocked()).toBe(true);
    expect(renderHook(() => useVaultLocked()).result.current).toBe(true);
  });

  it("starts quiet, so a fresh boot draws no arc for work nobody started", () => {
    expect(getVaultActivity()).toEqual(NO_VAULT_ACTIVITY);
  });

  it("wakes its readers when the numbers move", () => {
    const { result } = renderHook(() => useVaultActivity());
    act(() => setVaultActivity({ ...NO_VAULT_ACTIVITY, count: 1, uploads: 1, written: 10, total: 100 }));
    expect(result.current.written).toBe(10);
    act(() => setVaultActivity({ ...NO_VAULT_ACTIVITY, count: 1, uploads: 1, written: 60, total: 100 }));
    expect(result.current.written).toBe(60);
  });

  it("hands back the same object on a repeat, so a re-render is never provoked by nothing", () => {
    const same = { ...NO_VAULT_ACTIVITY, count: 2, uploads: 2, written: 5, total: 50 };
    setVaultActivity(same);
    const first = getVaultActivity();
    setVaultActivity({ ...same });
    expect(getVaultActivity()).toBe(first);
  });

  it("follows the lock both ways, which is what the tab icon draws", () => {
    const { result } = renderHook(() => useVaultLocked());
    act(() => setVaultLocked(false));
    expect(result.current).toBe(false);
    act(() => setVaultLocked(true));
    expect(result.current).toBe(true);
  });

  it("reads the Spaces count off the persisted list, and nothing off a broken one", async () => {
    const { __map } = jest.requireMock("@/lib/keychain") as { __map: Map<string, string> };
    __map.set("dosya.vault.workspaces.a", JSON.stringify([{ id: "s1" }, { id: "s2" }]));
    __map.set("dosya.vault.workspaces.b", "not json");
    expect(await countKnownSpaces("a")).toBe(2);
    expect(await countKnownSpaces("b")).toBe(0);
    expect(await countKnownSpaces("never-seen")).toBe(0);
  });
});

// This module exists to keep the 3 MB e2ee bundle off the boot path while the
// tab bar and the plus button still report the Vault. The guards below are the
// whole reason it is a separate file, and they fail the moment a convenient
// import puts the bundle back under the first frame.
describe("the boot path stays clear of the Vault's engine", () => {
  it("status.ts reaches for nothing heavier than the keychain", () => {
    const s = src("src", "vault", "status.ts");
    expect(s).not.toContain("@dosya-dev/e2ee");
    expect(s).not.toContain('from "./store"');
    expect(s).not.toContain('from "./engine"');
    expect(s).not.toContain('from "./runtime"');
  });

  it.each([
    ["src/orbit/OrbitButton.tsx"],
    ["src/orbit/OrbitSheet.tsx"],
    ["src/orbit/orbitModel.ts"],
    ["src/vault/ui/VaultTabIcon.tsx"],
  ])("%s asks status.ts for the Vault, never the store", (file) => {
    const s = src(...file.split("/"));
    expect(s).toContain('"@/vault/status"');
    expect(s).not.toContain('"@/vault/store"');
  });
});
