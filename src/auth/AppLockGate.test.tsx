import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Text, type AppStateStatus } from "react-native";

const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));
jest.mock("./biometric", () => ({
  getBiometricEnabled: jest.fn(async () => mockMem.get("dosya.biometric") === "1"),
  setBiometricEnabled: jest.fn(async (on: boolean) => { if (on) mockMem.set("dosya.biometric", "1"); else mockMem.delete("dosya.biometric"); }),
  authenticateBiometric: jest.fn(),
  isBiometricAvailable: jest.fn(async () => true),
  biometricKind: jest.fn(async () => "face"),
}));
const mockSignOut = jest.fn(async () => {});
jest.mock("./authStore", () => ({
  useAuthStore: (sel: (s: { signOut: () => Promise<void> }) => unknown) => sel({ signOut: mockSignOut }),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

import { AppLockGate } from "./AppLockGate";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { authenticateBiometric } from "./biometric";
import { hasPin, setLockAfter, setPin } from "./appLock";

const auth = authenticateBiometric as jest.Mock;

/** Drive the gate's AppState listener the way the OS would. */
let fireAppState: (state: AppStateStatus) => void;

async function typePin(pin: string) {
  for (const d of pin) fireEvent.press(screen.getByTestId(`pin-key-${d}`));
  // verifyPin hashes asynchronously; let it settle.
  await act(async () => {});
}

function background(ms: number) {
  act(() => fireAppState("inactive"));
  act(() => fireAppState("background"));
  jest.setSystemTime(Date.now() + ms);
  act(() => fireAppState("active"));
}

describe("AppLockGate", () => {
  beforeEach(() => {
    mockMem.clear();
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    auth.mockResolvedValue(false);
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, cb: (s: AppStateStatus) => void) => {
      fireAppState = cb;
      return { remove: jest.fn() };
    }) as never);
  });
  afterEach(() => jest.useRealTimers());

  it("renders children when App lock is off", async () => {
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByText("secret");
    expect(auth).not.toHaveBeenCalled();
  });

  it("asks for the PIN on a cold start and opens on the right one", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    expect(screen.queryByTestId("pin-key-biometric")).toBeNull();
    await typePin("482913");
    await screen.findByText("secret");
  });

  it("stays locked on a wrong PIN and says so", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("000000");
    await waitFor(() => expect(screen.getByTestId("pin-error").props.children).toBe("Wrong PIN"));
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("counts down tries from the fifth wrong one", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    for (let i = 0; i < 5; i++) await typePin("000000");
    await waitFor(() => expect(screen.getByTestId("pin-error").props.children).toBe("Wrong PIN. 5 tries left."));
  });

  it("wipes the lock and signs out at the tenth wrong try", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    for (let i = 0; i < 10; i++) await typePin("000000");
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(await hasPin()).toBe(false);
  });

  it("Forgot PIN? signs out after the confirmation", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    fireEvent.press(await screen.findByTestId("pin-forgot"));
    expect(screen.getByText("Are you sure?")).toBeTruthy();
    fireEvent.press(screen.getByTestId("confirm"));
    finishSheetDismissal();
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    await waitFor(async () => expect(await hasPin()).toBe(false));
  });

  it("keeps the PIN until the sign-out has gone through", async () => {
    // Killing the app mid sign-out must reopen it locked, not signed in and open.
    let finish!: () => void;
    mockSignOut.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    fireEvent.press(await screen.findByTestId("pin-forgot"));
    fireEvent.press(screen.getByTestId("confirm"));
    finishSheetDismissal();
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(await hasPin()).toBe(true);
    await act(async () => finish());
    await waitFor(async () => expect(await hasPin()).toBe(false));
  });

  it("opens Face ID by itself when it is on, without the phone passcode fallback", async () => {
    await setPin("482913");
    mockMem.set("dosya.biometric", "1");
    auth.mockResolvedValue(true);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByText("secret");
    expect(auth).toHaveBeenCalledWith({ pinFallback: true });
  });

  it("falls back to the PIN pad when Face ID fails, with a key to try again", async () => {
    await setPin("482913");
    mockMem.set("dosya.biometric", "1");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    auth.mockResolvedValue(true);
    fireEvent.press(screen.getByTestId("pin-key-biometric"));
    await screen.findByText("secret");
  });

  it("does not lock again before the Lock after time has passed", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("482913");
    await screen.findByText("secret");

    background(30_000);
    expect(screen.getByText("secret")).toBeTruthy();
  });

  it("locks again once the app was in the background longer than Lock after", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("482913");
    await screen.findByText("secret");

    background(61_000);
    await screen.findByTestId("pin-check");
  });

  it("Immediately locks on every return from the background", async () => {
    await setPin("482913");
    await setLockAfter(0);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("482913");
    await screen.findByText("secret");

    background(0);
    await screen.findByTestId("pin-check");
  });

  it("locks again when the clock was set back while away", async () => {
    await setPin("482913");
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("482913");
    await screen.findByText("secret");

    background(-3_600_000);
    await screen.findByTestId("pin-check");
  });

  it("with Immediately, hides the app as soon as it goes to the background", async () => {
    await setPin("482913");
    await setLockAfter(0);
    mockMem.set("dosya.biometric", "1");
    auth.mockResolvedValueOnce(false);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("482913");
    await screen.findByText("secret");
    auth.mockClear();

    act(() => fireAppState("background"));
    expect(screen.queryByText("secret")).toBeNull();
    expect(auth).not.toHaveBeenCalled();
    act(() => fireAppState("active"));
    await waitFor(() => expect(auth).toHaveBeenCalledWith({ pinFallback: true }));
  });

  it("does not lock when the Face ID sheet only bounced the app inactive", async () => {
    await setPin("482913");
    await setLockAfter(0);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-check");
    await typePin("482913");
    await screen.findByText("secret");

    act(() => fireAppState("inactive"));
    act(() => fireAppState("active"));
    expect(screen.getByText("secret")).toBeTruthy();
  });

  it("picks up a PIN set from Settings while the app is open", async () => {
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByText("secret");
    await act(async () => { await setPin("482913"); });
    await act(async () => { await setLockAfter(0); });

    background(0);
    await screen.findByTestId("pin-check");
  });

  it("asks a biometric-only user from before PINs to set one after the scan", async () => {
    mockMem.set("dosya.biometric", "1");
    auth.mockResolvedValue(true);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-setup");
    expect(auth).toHaveBeenCalledWith();
    await typePin("482913");
    await typePin("482913");
    await screen.findByText("secret");
    expect(await hasPin()).toBe(true);
  });

  it("lets that user turn App lock off instead", async () => {
    mockMem.set("dosya.biometric", "1");
    auth.mockResolvedValue(true);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    fireEvent.press(await screen.findByTestId("pin-secondary"));
    await screen.findByText("secret");
    expect(mockMem.has("dosya.biometric")).toBe(false);
  });

  it("tells mismatched PINs apart during setup", async () => {
    mockMem.set("dosya.biometric", "1");
    auth.mockResolvedValue(true);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByTestId("pin-setup");
    await typePin("482913");
    await typePin("111111");
    await waitFor(() => expect(screen.getByTestId("pin-error").props.children).toBe("The PINs didn't match. Try again."));
    expect(await hasPin()).toBe(false);
  });

  it("opens when biometrics are on from before PINs but no longer enrolled", async () => {
    mockMem.set("dosya.biometric", "1");
    jest.requireMock("./biometric").isBiometricAvailable.mockResolvedValueOnce(false);
    render(<AppLockGate><Text>secret</Text></AppLockGate>);
    await screen.findByText("secret");
  });
});
