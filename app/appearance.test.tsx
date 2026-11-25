import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import AppearanceScreen from "./appearance";
import { useAppearance } from "@/theme/themeStore";
import { __resetI18nForTests } from "@/lib/i18n";
import { renderInLocale } from "../test-utils/i18n-sweep";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/api", () => ({ apiRequest: jest.fn(async () => ({ ok: true })) }));

beforeEach(() => {
  __resetI18nForTests();
  mockPush.mockClear();
  useAppearance.setState({ theme: "default", mode: "system", hydrated: true });
});

it("renders all 8 themes and the three modes", () => {
  render(<AppearanceScreen />);
  for (const id of ["default", "mono", "claude", "amber", "ocean", "bubblegum", "vercel", "neo-brutal"]) {
    expect(screen.getByTestId(`theme-${id}`)).toBeTruthy();
  }
  expect(screen.getByTestId("mode-light")).toBeTruthy();
  expect(screen.getByTestId("mode-dark")).toBeTruthy();
  expect(screen.getByTestId("mode-system")).toBeTruthy();
});

it("marks the active mode and theme as selected", () => {
  useAppearance.setState({ theme: "ocean", mode: "dark" });
  render(<AppearanceScreen />);
  expect(screen.getByTestId("mode-dark").props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId("mode-light").props.accessibilityState.selected).toBe(false);
  expect(screen.getByTestId("theme-ocean").props.accessibilityState.selected).toBe(true);
});

it("switches theme", async () => {
  render(<AppearanceScreen />);
  fireEvent.press(screen.getByTestId("theme-amber"));
  await waitFor(() => expect(useAppearance.getState().theme).toBe("amber"));
});

it("switches mode", async () => {
  render(<AppearanceScreen />);
  fireEvent.press(screen.getByTestId("mode-dark"));
  await waitFor(() => expect(useAppearance.getState().mode).toBe("dark"));
});

describe("in Turkish", () => {
  // Language moved to Settings; the screen is themes and modes only.
  it("renders the whole screen with nothing left in English", async () => {
    const view = await renderInLocale(<AppearanceScreen />, "tr");
    expect(screen.getByText("Koyu")).toBeTruthy();
    expect(screen.queryByTestId("language-row")).toBeNull();
    expect(view.leftover()).toEqual([]);
  });
});
