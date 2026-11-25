import { authEventFor } from "./authEvents";

const NOW = 1_800_000_000;
const user = (age: number) => ({ created_at: NOW - age });
const out = { status: "signedOut", user: null };
const loading = { status: "loading", user: null };

describe("authEventFor", () => {
  it("counts a sign-in by its method", () => {
    expect(authEventFor({ status: "signedIn", user: user(86_400) }, out, "password", NOW)).toEqual({ name: "login", params: { method: "password" } });
    expect(authEventFor({ status: "signedIn", user: user(86_400) }, out, "google", NOW)).toEqual({ name: "login", params: { method: "google" } });
    expect(authEventFor({ status: "signedIn", user: user(86_400) }, out, null, NOW)).toEqual({ name: "login", params: { method: "unknown" } });
  });

  it("does not count a session restored at launch", () => {
    expect(authEventFor({ status: "signedIn", user: user(86_400) }, loading, "password", NOW)).toBeNull();
    expect(authEventFor(out, loading, null, NOW)).toBeNull();
  });

  it("counts the email-code step as the sign-up", () => {
    expect(authEventFor(
      { status: "signedIn", user: user(30), pendingVerificationEmail: null },
      { status: "signedOut", user: null, pendingVerificationEmail: "ada@example.com" },
      "password", NOW,
    )).toEqual({ name: "sign_up", params: { method: "password" } });
  });

  it("counts a provider's brand-new account as a sign-up, an older one as a sign-in", () => {
    expect(authEventFor({ status: "signedIn", user: user(20) }, out, "apple", NOW)).toEqual({ name: "sign_up", params: { method: "apple" } });
    expect(authEventFor({ status: "signedIn", user: user(600) }, out, "apple", NOW)).toEqual({ name: "login", params: { method: "apple" } });
    // Milliseconds from an older API are read as the same moment.
    expect(authEventFor({ status: "signedIn", user: { created_at: (NOW - 20) * 1000 } }, out, "google", NOW)).toEqual({ name: "sign_up", params: { method: "google" } });
  });

  it("does not turn a password sign-in on a young account into a second sign-up", () => {
    expect(authEventFor({ status: "signedIn", user: user(20) }, out, "password", NOW)).toEqual({ name: "login", params: { method: "password" } });
  });

  it("counts a sign-out", () => {
    expect(authEventFor(out, { status: "signedIn", user: user(1) }, null, NOW)).toEqual({ name: "logout" });
  });
});
