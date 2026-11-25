// The Personas first run for each engine state that is not ready yet: off
// (Start reading on this device), needs_identity (the Vault setup) and
// needs_unlock (the Vault unlock), then the hand-over to the engine.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { FirstRun } from "./FirstRun";
import { fakeHost } from "./device/__fixtures__/fake-host";

jest.mock("./device/engine-host", () => require("./device/__fixtures__/fake-host"));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("@/auth/authStore", () => ({ useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }) }));
jest.mock("@/vault/store", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { create } = require("zustand");
  const useVault = create(() => ({ status: "locked", error: null, recoveryKeyOnce: null, hydrate: jest.fn(async () => {}) }));
  return { useVault };
});
jest.mock("@/vault/ui/UnlockCard", () => ({ UnlockCard: () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return <Text>UNLOCK-CARD</Text>;
} }));
jest.mock("@/vault/ui/onboarding/PassphraseStep", () => ({ PassphraseStep: ({ onBack }: { onBack: () => void }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return <Pressable testID="passphrase-back" onPress={onBack}><Text>PASSPHRASE-STEP</Text></Pressable>;
} }));

import { useVault } from "@/vault/store";

const vault = useVault as unknown as { setState(s: object): void; getState(): { hydrate: jest.Mock } };

beforeEach(() => {
  fakeHost.reset({ state: "off" });
  vault.setState({ status: "locked", error: null, recoveryKeyOnce: null });
  (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
});
afterEach(async () => { await act(async () => {}); });

const DESC = "Personas reads faces on this device and groups photos of the same person. The result is encrypted with your own key, so dosya can never see it. Your other devices share it. Vault, hidden and locked photos are left out.";

describe("off", () => {
  it("says what Personas does on this device, that the desktop app reads faster, and links the privacy policy", () => {
    render(<FirstRun wsId="w1" state="off" engine={fakeHost.engine as never} />);
    expect(screen.getByText("Find people in your photos")).toBeTruthy();
    expect(screen.getByText(DESC)).toBeTruthy();
    expect(screen.getByText("Reading is faster on the desktop app.")).toBeTruthy();
    fireEvent.press(screen.getByText("How Personas protects your privacy"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://dosya.dev/biometric-data-policy");
  });

  it("Start reading on this device turns it on; a failure says try again", async () => {
    render(<FirstRun wsId="w1" state="off" engine={fakeHost.engine as never} />);
    fakeHost.engine.turnOn.mockRejectedValueOnce(new Error("offline"));
    fireEvent.press(screen.getByText("Start reading on this device"));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    fireEvent.press(screen.getByText("Start reading on this device"));
    await act(async () => {});
    expect(fakeHost.engine.turnOn).toHaveBeenCalledTimes(2);
  });

  it("names no region, owner, plan or consent", () => {
    render(<FirstRun wsId="w1" state="off" engine={fakeHost.engine as never} />);
    for (const gone of [/region/i, /owner/i, /plan/i, /agree/i, /consent/i, /Keep it off/]) expect(screen.queryByText(gone)).toBeNull();
  });
});

describe("needs_identity", () => {
  it("adds the Vault line and opens the Vault setup, with a way back", () => {
    render(<FirstRun wsId="w1" state="needs_identity" engine={fakeHost.engine as never} />);
    expect(screen.getByText(DESC)).toBeTruthy();
    expect(screen.getByText("Personas uses your Vault passphrase to protect your people. Set it up to continue.")).toBeTruthy();
    expect(vault.getState().hydrate).toHaveBeenCalledWith("u1");
    fireEvent.press(screen.getByText("Set up Vault"));
    expect(screen.getByText("PASSPHRASE-STEP")).toBeTruthy();
    fireEvent.press(screen.getByTestId("passphrase-back"));
    expect(screen.getByText("Set up Vault")).toBeTruthy();
  });

  it("once the Vault is set up, hands the identity to Personas once", async () => {
    render(<FirstRun wsId="w1" state="needs_identity" engine={fakeHost.engine as never} />);
    fireEvent.press(screen.getByText("Set up Vault"));
    await act(async () => { vault.setState({ status: "unlocked" }); });
    expect(fakeHost.unlockPersonas).toHaveBeenCalledWith("w1");
    await act(async () => { vault.setState({ error: "x" }); });
    expect(fakeHost.unlockPersonas).toHaveBeenCalledTimes(1);
  });
});

describe("needs_unlock", () => {
  it("shows the unlock line and the Vault unlock card, not the description", () => {
    render(<FirstRun wsId="w1" state="needs_unlock" engine={fakeHost.engine as never} />);
    expect(screen.getByText("Unlock with your Vault passphrase to open your people on this device.")).toBeTruthy();
    expect(screen.getByText("UNLOCK-CARD")).toBeTruthy();
    expect(screen.queryByText(DESC)).toBeNull();
    expect(fakeHost.unlockPersonas).not.toHaveBeenCalled();
  });

  it("with the Vault already unlocked, opens Personas at once; a failure offers Try again", async () => {
    vault.setState({ status: "unlocked" });
    fakeHost.unlockPersonas.mockRejectedValueOnce(new Error("offline"));
    render(<FirstRun wsId="w1" state="needs_unlock" engine={fakeHost.engine as never} />);
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.queryByText("UNLOCK-CARD")).toBeNull();
    fireEvent.press(screen.getByText("Try again"));
    await act(async () => {});
    expect(fakeHost.unlockPersonas).toHaveBeenCalledTimes(2);
  });
});
