const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("./api", () => ({
  mobilePasskeyOptions: jest.fn(),
  mobilePasskeyVerify: jest.fn(),
}));
jest.mock("@/api", () => ({
  setTokenProvider: jest.fn(),
  setRefreshHandler: jest.fn(),
  ApiError: jest.requireActual("../api/errors").ApiError,
}));
jest.mock("react-native-passkey", () => ({
  Passkey: { isSupported: jest.fn(() => true), get: jest.fn() },
}));

import { Passkey } from "react-native-passkey";
import { useAuthStore } from "./authStore";
import * as authApi from "./api";
import { getLastMethod } from "./lastMethod";
import { loadTokens } from "./tokenStore";
import { ApiError } from "../api/errors";

const USER = { id: "u", email: "a@b.com", name: "A", created_at: 1 };
const OPTIONS = { challenge: "ch", rpId: "dosya.dev" };
const NATIVE_RESULT = {
  id: "cred+1=",
  rawId: "cred+1=",
  response: { clientDataJSON: "c", authenticatorData: "a", signature: "s", userHandle: "u" },
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, error: null });
  jest.clearAllMocks();
  (authApi.mobilePasskeyOptions as jest.Mock).mockResolvedValue({ challengeToken: "tok", options: OPTIONS });
});

it("signs in: options, native sheet, verify, then tokens stored like a password login", async () => {
  (Passkey.get as jest.Mock).mockResolvedValue(NATIVE_RESULT);
  (authApi.mobilePasskeyVerify as jest.Mock).mockResolvedValue({ access: "dosm_a", refresh: "dosr_b", user: USER });

  await useAuthStore.getState().signInWithPasskey();

  expect(Passkey.get).toHaveBeenCalledWith(OPTIONS);
  expect(authApi.mobilePasskeyVerify).toHaveBeenCalledWith("tok", expect.objectContaining({
    id: "cred-1",
    rawId: "cred-1",
    type: "public-key",
  }));
  expect(useAuthStore.getState().status).toBe("signedIn");
  expect(useAuthStore.getState().user).toEqual(USER);
  expect(await loadTokens()).toEqual({ access: "dosm_a", refresh: "dosr_b" });
  expect(await getLastMethod()).toBe("passkey");
});

it("shows no error when the user closes the sheet", async () => {
  (Passkey.get as jest.Mock).mockRejectedValue({ error: "UserCancelled", message: "The user cancelled the request." });

  await useAuthStore.getState().signInWithPasskey();

  expect(useAuthStore.getState().error).toBeNull();
  expect(useAuthStore.getState().status).toBe("signedOut");
  expect(authApi.mobilePasskeyVerify).not.toHaveBeenCalled();
});

it("clears an earlier error when a new attempt is cancelled", async () => {
  useAuthStore.setState({ error: "old" });
  (Passkey.get as jest.Mock).mockRejectedValue({ error: "UserCancelled", message: "" });
  await useAuthStore.getState().signInWithPasskey();
  expect(useAuthStore.getState().error).toBeNull();
});

it("reports a library failure in our copy, not the library's", async () => {
  (Passkey.get as jest.Mock).mockRejectedValue({ error: "RequestFailed", message: "RP ID cannot be validated." });
  await useAuthStore.getState().signInWithPasskey();
  expect(useAuthStore.getState().error).toBe("We couldn't sign you in with that passkey. Try again.");
});

it("shows the server's sentence when verify refuses, and stores nothing", async () => {
  (Passkey.get as jest.Mock).mockResolvedValue(NATIVE_RESULT);
  (authApi.mobilePasskeyVerify as jest.Mock).mockRejectedValue(new ApiError("Could not sign in with that passkey.", 401));

  await useAuthStore.getState().signInWithPasskey();

  expect(useAuthStore.getState().error).toBe("Could not sign in with that passkey.");
  expect(useAuthStore.getState().status).toBe("signedOut");
  expect(await loadTokens()).toBeNull();
});
