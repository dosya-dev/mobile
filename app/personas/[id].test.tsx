// /personas/[id]: one persona from this phone's engine. The first run while
// Personas is not ready, the persona once it is, Personas settings in the
// header, and a workspace switch goes back (the persona was the old one's).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import PersonaScreen from "./[id]";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { card, fakeHost, READY } from "@/personas/device/__fixtures__/fake-host";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockScreen: { options: Record<string, unknown> | null } = { options: null };
let mockFocused = true;
jest.mock("expo-router", () => ({
  Stack: { Screen: ({ options }: { options: Record<string, unknown> }) => { mockScreen.options = options; return null; } },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: "p1" }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focused = mockFocused;
    jest.requireActual("react").useEffect(() => { if (focused) return cb(); }, [cb, focused]);
  },
}));
jest.mock("@/personas/device/engine-host", () => require("@/personas/device/__fixtures__/fake-host"));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok", useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }) }));
jest.mock("@/files/hooks", () => ({ useWorkspaces: jest.fn() }));
jest.mock("@/files/FileThumb", () => ({ FileThumb: () => null }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("@/vault/store", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { create } = require("zustand");
  return { useVault: create(() => ({ status: "locked", error: null, recoveryKeyOnce: null, hydrate: jest.fn(async () => {}) })) };
});
jest.mock("@/vault/ui/UnlockCard", () => ({ UnlockCard: () => null }));
jest.mock("@/vault/ui/onboarding/PassphraseStep", () => ({ PassphraseStep: () => null }));
jest.mock("@/vault/ui/onboarding/RecoveryKeyStep", () => ({ RecoveryKeyStep: () => null }));

beforeEach(() => {
  fakeHost.reset(READY);
  fakeHost.engine.personas = [card("p1", "Alex")];
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockRouter.canGoBack.mockReturnValue(true);
  mockFocused = true;
  useWorkspaceStore.setState({ activeId: "w1" });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Family photos" }] });
});
afterEach(async () => { await act(async () => {}); });

it("shows the persona once Personas is ready, with Personas settings in the header", async () => {
  render(<PersonaScreen />);
  expect(await screen.findByTestId("persona-p1")).toBeTruthy();
  const right = (mockScreen.options?.headerRight as () => React.ReactElement)();
  render(right);
  fireEvent.press(screen.getByTestId("personas-settings-link"));
  expect(mockRouter.push).toHaveBeenCalledWith("/personas-settings");
});

it("shows the first run while Personas is locked", () => {
  fakeHost.set({ status: { state: "needs_unlock" } });
  render(<PersonaScreen />);
  expect(screen.getByTestId("personas-first-run")).toBeTruthy();
});

it("a workspace switch goes back once the screen is in front again", async () => {
  const r = render(<PersonaScreen />);
  await screen.findByTestId("persona-p1");
  mockFocused = false;
  await act(async () => { useWorkspaceStore.setState({ activeId: "w2" }); });
  r.rerender(<PersonaScreen />);
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(screen.queryByTestId("persona-p1")).toBeNull();
  mockFocused = true;
  r.rerender(<PersonaScreen />);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
