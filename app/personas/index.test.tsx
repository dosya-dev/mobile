// /personas for every signed-in member: the engine's status picks the
// screen. Loading, Try again, the first run while not ready, the progress
// card over the grid once ready, and the recovery key a Vault setup shows.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import PersonasScreen from "./index";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { card, fakeHost, READY } from "@/personas/device/__fixtures__/fake-host";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockScreen: { options: Record<string, unknown> | null } = { options: null };
jest.mock("expo-router", () => ({
  Stack: { Screen: ({ options }: { options: Record<string, unknown> }) => { mockScreen.options = options; return null; } },
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => void | (() => void)) => { jest.requireActual("react").useEffect(cb, [cb]); },
}));
jest.mock("@/personas/device/engine-host", () => require("@/personas/device/__fixtures__/fake-host"));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok", useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }) }));
jest.mock("@/files/hooks", () => ({ useWorkspaces: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("@/vault/store", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { create } = require("zustand");
  return { useVault: create(() => ({ status: "locked", error: null, recoveryKeyOnce: null, hydrate: jest.fn(async () => {}) })) };
});
jest.mock("@/vault/ui/UnlockCard", () => ({ UnlockCard: () => null }));
jest.mock("@/vault/ui/onboarding/PassphraseStep", () => ({ PassphraseStep: () => null }));
jest.mock("@/vault/ui/onboarding/RecoveryKeyStep", () => ({ RecoveryKeyStep: () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return <Text>RECOVERY-KEY</Text>;
} }));

import { useVault } from "@/vault/store";

beforeEach(() => {
  fakeHost.reset(READY);
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockScreen.options = null;
  useWorkspaceStore.setState({ activeId: "w1" });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Family photos" }] });
  (useVault as unknown as { setState(s: object): void }).setState({ recoveryKeyOnce: null });
});
afterEach(async () => { await act(async () => {}); });

const headerRight = () => (mockScreen.options?.headerRight as (() => React.ReactElement) | undefined)?.();

it("shows a spinner until the engine answers, then Try again when it could not load", () => {
  fakeHost.set({ status: null });
  const { rerender } = render(<PersonasScreen />);
  expect(screen.getByTestId("personas-loading")).toBeTruthy();
  act(() => fakeHost.set({ status: null, error: new Error("offline") }));
  rerender(<PersonasScreen />);
  expect(screen.getByText("Personas could not be loaded.")).toBeTruthy();
  fireEvent.press(screen.getByTestId("personas-retry"));
  expect(fakeHost.refresh).toHaveBeenCalled();
});

it("shows the first run while Personas is off, locked or has no Vault", () => {
  for (const state of ["off", "needs_identity", "needs_unlock"] as const) {
    fakeHost.set({ status: { state } });
    const { unmount } = render(<PersonasScreen />);
    expect(screen.getByTestId("personas-first-run")).toBeTruthy();
    expect(screen.getByText("Find people in your photos")).toBeTruthy();
    unmount();
  }
});

it("once ready: the progress card over the grid, named first, and the settings in the header for everyone", () => {
  fakeHost.set({ status: { ...READY, read: 3, total: 10 } });
  fakeHost.engine.personas = [card("p1", "Alex"), card("g1", null)];
  render(<PersonasScreen />);
  expect(screen.getByText("Read 3 of 10 photos on this device")).toBeTruthy();
  expect(screen.getByTestId("personas-grid")).toBeTruthy();
  expect(screen.getByText("Alex")).toBeTruthy();
  render(headerRight()!);
  fireEvent.press(screen.getByTestId("personas-settings-link"));
  expect(mockRouter.push).toHaveBeenCalledWith("/personas-settings");
});

it("Pause on the progress card pauses reading on this phone", () => {
  fakeHost.set({ status: { ...READY, read: 3, total: 10 } });
  render(<PersonasScreen />);
  fireEvent.press(screen.getByText("Pause"));
  expect(fakeHost.engine.setPaused).toHaveBeenCalledWith(true);
});

it("says nobody was found yet once everything is read and nobody shows", () => {
  fakeHost.set({ status: { ...READY, read: 10, total: 10 } });
  render(<PersonasScreen />);
  expect(screen.getByText("No people found yet")).toBeTruthy();
  expect(screen.queryByTestId("personas-grid")).toBeNull();
});

it("while photos are still being read, the grid shows More coming even with nobody yet", () => {
  fakeHost.set({ status: { ...READY, read: 0, total: 10 } });
  render(<PersonasScreen />);
  expect(screen.getByTestId("personas-more-coming")).toBeTruthy();
  expect(screen.queryByText("No people found yet")).toBeNull();
});

it("a Vault set up from here shows its recovery key before anything else, without the header", () => {
  (useVault as unknown as { setState(s: object): void }).setState({ recoveryKeyOnce: "abcd" });
  render(<PersonasScreen />);
  expect(screen.getByText("RECOVERY-KEY")).toBeTruthy();
  expect(mockScreen.options?.headerShown).toBe(false);
});

it("a phone that cannot read photos says so over the grid, which still shows the people from other devices", () => {
  fakeHost.set({ status: { ...READY, read: 3, total: 10 } });
  fakeHost.device = { supported: false, held: false, heldReason: null };
  fakeHost.engine.personas = [card("p1", "Alex")];
  render(<PersonasScreen />);
  expect(screen.getByText("This device can't read photos. Your other devices can.")).toBeTruthy();
  expect(screen.getByText("Alex")).toBeTruthy();
  expect(screen.queryByTestId("personas-more-coming")).toBeNull();
});

it("while the read gate waits, the card says what for", () => {
  fakeHost.set({ status: { ...READY, read: 0, total: 10 } });
  fakeHost.device = { supported: true, held: true, heldReason: "charger" };
  render(<PersonasScreen />);
  expect(screen.getByText("Waiting for a charger")).toBeTruthy();
});
