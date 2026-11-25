jest.mock("@/lib/keychain", () => ({ getItem: async () => null, setItem: async () => {}, deleteItem: async () => {} }));
jest.mock("@/vault/engine", () => ({ createVaultEngine: () => ({}) }));
jest.mock("@/vault/cache", () => ({
  cachePathFor: () => ({ dir: "/c", fileName: "f" }),
  cachedFile: async () => null,
  createCacheSink: () => ({ sink: async () => {}, finish: async () => "/c/f", abort: async () => {} }),
  wipeVaultCache: async () => {},
}));
jest.mock("@/vault/fileSource", () => ({ fileSourceFromUri: async () => ({ totalSize: 0, boundaries: [], read: async () => new Uint8Array(0), close: () => {} }) }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { UnlockCard } from "./UnlockCard";
import { useVault } from "@/vault/store";
import type { VaultEngine } from "@/vault/engine";

const unlock = jest.fn(async (passphrase: string) => { if (passphrase !== "right") throw new Error("engine: unlock failed"); });
const unlockWithRecoveryKey = jest.fn(async () => {});

beforeEach(() => {
  unlock.mockClear();
  unlockWithRecoveryKey.mockClear();
  useVault.setState({ status: "locked", hasIdentity: true, error: null, busy: false, spaces: [], activeSpaceId: null, entries: [], recoveryKeyOnce: null, transfers: {} });
  useVault.getState().__setEngine({ unlock, unlockWithRecoveryKey } as unknown as VaultEngine);
});

const value = (testID: string) => screen.getByTestId(testID).props.value as string;

describe("UnlockCard", () => {
  it("unlocks with the passphrase and then forgets it", async () => {
    render(<UnlockCard />);
    fireEvent.changeText(screen.getByTestId("vault-unlock-pass"), "right");
    fireEvent.press(screen.getByTestId("vault-unlock-submit"));

    await waitFor(() => expect(unlock).toHaveBeenCalledWith("right"));
    await waitFor(() => expect(value("vault-unlock-pass")).toBe(""));
    expect(useVault.getState().status).toBe("unlocked");
  });

  it("clears the field after a failed attempt too, and shows the store's one sentence", async () => {
    render(<UnlockCard />);
    fireEvent.changeText(screen.getByTestId("vault-unlock-pass"), "wrong");
    fireEvent.press(screen.getByTestId("vault-unlock-submit"));

    await waitFor(() => expect(screen.getByText("Couldn't unlock. Check your passphrase and try again.")).toBeTruthy());
    expect(value("vault-unlock-pass")).toBe("");
  });

  it("swaps in the recovery-key field, which must not be autocorrected or capitalised", () => {
    render(<UnlockCard />);
    expect(screen.queryByTestId("vault-recovery-key")).toBeNull();

    fireEvent.press(screen.getByTestId("vault-recovery-toggle"));

    const field = screen.getByTestId("vault-recovery-key");
    expect(field.props.autoCapitalize).toBe("none");
    expect(field.props.autoCorrect).toBe(false);
    // A recovery key is not a passphrase: it is pasted and must be readable.
    expect(field.props.secureTextEntry).toBeFalsy();
    expect(screen.queryByTestId("vault-unlock-pass")).toBeNull();
  });

  it("unlocks with a recovery key and clears that field as well", async () => {
    render(<UnlockCard />);
    fireEvent.press(screen.getByTestId("vault-recovery-toggle"));
    fireEvent.changeText(screen.getByTestId("vault-recovery-key"), "aaaa-bbbb-cccc");
    fireEvent.press(screen.getByTestId("vault-recovery-submit"));

    await waitFor(() => expect(unlockWithRecoveryKey).toHaveBeenCalledWith("aaaa-bbbb-cccc"));
    await waitFor(() => expect(value("vault-recovery-key")).toBe(""));
  });

  it("keeps both buttons inert while the field is empty or the store is busy", () => {
    render(<UnlockCard />);
    expect(screen.getByTestId("vault-unlock-submit")).toBeDisabled();

    fireEvent.changeText(screen.getByTestId("vault-unlock-pass"), "right");
    expect(screen.getByTestId("vault-unlock-submit")).not.toBeDisabled();

    fireEvent.press(screen.getByTestId("vault-recovery-toggle"));
    expect(screen.getByTestId("vault-recovery-submit")).toBeDisabled();
    fireEvent.changeText(screen.getByTestId("vault-recovery-key"), "aaaa");
    expect(screen.getByTestId("vault-recovery-submit")).not.toBeDisabled();
  });

  it("is inert while an unlock is already in flight", () => {
    useVault.setState({ busy: true });
    render(<UnlockCard />);
    fireEvent.changeText(screen.getByTestId("vault-unlock-pass"), "right");
    expect(screen.getByTestId("vault-unlock-submit")).toBeDisabled();
  });
});
