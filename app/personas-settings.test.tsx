// /personas-settings: this member's Personas settings for the active
// workspace (src/personas/PersonasSettings), keyed by workspace.
import { act, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PersonasSettingsScreen from "./personas-settings";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { fakeHost, READY } from "@/personas/device/__fixtures__/fake-host";

const mockScreen: { options: Record<string, unknown> | null } = { options: null };
jest.mock("expo-router", () => ({
  Stack: { Screen: ({ options }: { options: Record<string, unknown> }) => { mockScreen.options = options; return null; } },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/personas/device/engine-host", () => require("@/personas/device/__fixtures__/fake-host"));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("@/files/hooks", () => ({ useWorkspaces: jest.fn() }));

beforeEach(() => {
  fakeHost.reset(READY);
  useWorkspaceStore.setState({ activeId: "w1" });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Family photos" }] });
});
afterEach(async () => { await act(async () => {}); });

it("is titled Personas settings and shows this member's settings", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><PersonasSettingsScreen /></QueryClientProvider>);
  expect(mockScreen.options?.title).toBe("Personas settings");
  expect(screen.getByTestId("personas-settings")).toBeTruthy();
  expect(screen.getByTestId("personas-switch").props.value).toBe(true);
});
