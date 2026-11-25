const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("./api", () => ({
  mobileLogin: jest.fn(),
  mobile2fa: jest.fn(),
  mobileRefresh: jest.fn(),
  mobileLogout: jest.fn(async () => {}),
  fetchMe: jest.fn(),
}));
jest.mock("@/api", () => ({
  setTokenProvider: jest.fn(),
  setRefreshHandler: jest.fn(),
  ApiError: jest.requireActual("../api/errors").ApiError,
}));
jest.mock("@/filesProvider/link", () => ({
  relinkFilesProvider: jest.fn(async () => {}),
  unlinkFilesProvider: jest.fn(async () => {}),
}));
jest.mock("@/billing/revenuecat", () => ({
  identifyBilling: jest.fn(async () => {}),
  resetBilling: jest.fn(async () => {}),
}));

import { identifyBilling, resetBilling } from "@/billing/revenuecat";
import { useAuthStore } from "./authStore";
import { saveTokens } from "./tokenStore";

beforeEach(async () => {
  jest.clearAllMocks();
  useAuthStore.setState({ status: "signedOut", user: null });
  await saveTokens({ access: "a", refresh: "r" });
});

it("identifies the billing user once a sign-in lands", () => {
  useAuthStore.setState({ status: "signedIn", user: { id: "u1", email: "a@b.c" } as never });
  expect(identifyBilling).toHaveBeenCalledWith("u1");
});

it("does not re-identify on unrelated state changes", () => {
  useAuthStore.setState({ status: "signedIn", user: { id: "u1", email: "a@b.c" } as never });
  useAuthStore.setState({ error: "x" });
  expect(identifyBilling).toHaveBeenCalledTimes(1);
});

it("resets billing on sign-out", async () => {
  useAuthStore.setState({ status: "signedIn", user: { id: "u1", email: "a@b.c" } as never });
  await useAuthStore.getState().signOut();
  expect(resetBilling).toHaveBeenCalledTimes(1);
});

it("a throwing billing layer never breaks auth", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  (identifyBilling as jest.Mock).mockImplementationOnce(() => { throw new Error("boom"); });
  (resetBilling as jest.Mock).mockRejectedValueOnce(new Error("boom"));
  expect(() => useAuthStore.setState({ status: "signedIn", user: { id: "u2", email: "a@b.c" } as never })).not.toThrow();
  await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();
  expect(useAuthStore.getState().status).toBe("signedOut");
  warn.mockRestore();
});
