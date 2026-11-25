const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("@/api", () => ({ apiRequest: jest.fn(async () => ({ ok: true })) }));

import { useAppearance, DEFAULT_THEME, DEFAULT_MODE } from "./themeStore";
import { apiRequest } from "@/api";

const mockApi = apiRequest as jest.Mock;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  useAppearance.setState({ theme: DEFAULT_THEME, mode: DEFAULT_MODE, hydrated: false });
  mockApi.mockReset();
  mockApi.mockResolvedValue({ ok: true });
});

it("defaults to the default theme in system mode", () => {
  expect(useAppearance.getState().theme).toBe("default");
  expect(useAppearance.getState().mode).toBe("system");
});

it("persists and rehydrates a choice", async () => {
  await useAppearance.getState().setTheme("ocean");
  useAppearance.setState({ theme: DEFAULT_THEME });
  await useAppearance.getState().hydrate();
  expect(useAppearance.getState().theme).toBe("ocean");
});

it("saves to the server when the theme changes", async () => {
  await useAppearance.getState().setMode("dark");
  expect(mockApi).toHaveBeenCalledWith("/api/me/appearance", expect.objectContaining({ method: "PUT" }));
});

it("rolls back when the server rejects the change", async () => {
  mockApi.mockRejectedValue(new Error("nope"));
  await expect(useAppearance.getState().setTheme("mono")).rejects.toThrow("nope");
  expect(useAppearance.getState().theme).toBe("default");
});

it("ignores unknown values from the server rather than theming to garbage", async () => {
  await useAppearance.getState().applyFromServer("not-a-theme", "sideways");
  expect(useAppearance.getState().theme).toBe("default");
  expect(useAppearance.getState().mode).toBe("system");
});

it("adopts valid server values (server wins, so themes follow you across devices)", async () => {
  await useAppearance.getState().applyFromServer("amber", "dark");
  expect(useAppearance.getState().theme).toBe("amber");
  expect(useAppearance.getState().mode).toBe("dark");
});

it("survives a corrupt cache", async () => {
  store["dosya.appearance"] = "{not json";
  await useAppearance.getState().hydrate();
  expect(useAppearance.getState().theme).toBe("default");
  expect(useAppearance.getState().hydrated).toBe(true);
});
