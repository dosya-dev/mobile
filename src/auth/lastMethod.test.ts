jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

import { getLastMethod, setLastMethod } from "./lastMethod";

it("persists and reads the last method", async () => {
  expect(await getLastMethod()).toBeNull();
  await setLastMethod("github");
  expect(await getLastMethod()).toBe("github");
});

it("reads back a passkey sign-in", async () => {
  await setLastMethod("passkey");
  expect(await getLastMethod()).toBe("passkey");
});

it("returns null for an unrecognised stored value", async () => {
  const SecureStore = require("expo-secure-store");
  await SecureStore.setItemAsync("dosya.last_method", "bogus");
  expect(await getLastMethod()).toBeNull();
});
