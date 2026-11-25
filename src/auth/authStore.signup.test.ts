jest.mock("./tokenStore", () => ({ saveTokens: jest.fn(), loadTokens: jest.fn(), clearTokens: jest.fn(), saveUser: jest.fn(), loadUser: jest.fn() }));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));

import { useAuthStore } from "./authStore";
import * as api from "./api";

beforeEach(() => {
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

it("signUp stores the pending email without signing in", async () => {
  jest.spyOn(api, "mobileSignup").mockResolvedValue({ email: "t@x.com" });
  await useAuthStore.getState().signUp("T", "t@x.com", "pw12345!");
  expect(useAuthStore.getState().pendingVerificationEmail).toBe("t@x.com");
  expect(useAuthStore.getState().status).not.toBe("signedIn");
});

it("signUp surfaces an error and stays signed out", async () => {
  jest.spyOn(api, "mobileSignup").mockRejectedValue(new Error("An account with this email already exists"));
  await useAuthStore.getState().signUp("T", "t@x.com", "pw12345!");
  expect(useAuthStore.getState().error).toBe("An account with this email already exists");
  expect(useAuthStore.getState().pendingVerificationEmail).toBeNull();
});

it("verifyEmail signs the user in and clears the pending email", async () => {
  useAuthStore.setState({ pendingVerificationEmail: "t@x.com" });
  jest.spyOn(api, "mobileVerifyEmail").mockResolvedValue({
    access: "a", refresh: "r", user: { id: "u", email: "t@x.com", name: "T", created_at: 1 },
  });
  await useAuthStore.getState().verifyEmail("123456");
  expect(useAuthStore.getState().status).toBe("signedIn");
  expect(useAuthStore.getState().pendingVerificationEmail).toBeNull();
});

it("verifyEmail without a pending email errors", async () => {
  useAuthStore.setState({ pendingVerificationEmail: null });
  await useAuthStore.getState().verifyEmail("123456");
  expect(useAuthStore.getState().error).toMatch(/sign up again/i);
});
