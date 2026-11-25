import type { LastMethod } from "@/auth/lastMethod";

type AuthSnapshot = {
  status: string;
  user: { created_at: number } | null;
  pendingVerificationEmail?: string | null;
};

/** An account this young, arriving through a provider, was just created by it. */
const NEW_ACCOUNT_SECONDS = 120;

/**
 * What an auth-store change means, or null. A session restored at launch goes
 * loading -> signedIn and is not a sign-in; only signedOut -> signedIn is.
 * Pure, so the tests can pin every path.
 */
export function authEventFor(
  state: AuthSnapshot,
  prev: AuthSnapshot,
  method: LastMethod | null,
  nowSeconds: number,
): { name: "login" | "sign_up" | "logout"; params?: { method: string } } | null {
  if (state.status === "signedOut" && prev.status === "signedIn") return { name: "logout" };
  if (state.status !== "signedIn" || prev.status !== "signedOut" || !state.user) return null;
  // The email-code step of a sign-up ends in a session: that is the sign-up.
  if (prev.pendingVerificationEmail && !state.pendingVerificationEmail) return { name: "sign_up", params: { method: "password" } };
  const viaProvider = method === "google" || method === "github" || method === "apple";
  const created = state.user.created_at > 1e12 ? state.user.created_at / 1000 : state.user.created_at;
  const isNew = viaProvider && Number.isFinite(created) && nowSeconds - created >= 0 && nowSeconds - created <= NEW_ACCOUNT_SECONDS;
  return { name: isNew ? "sign_up" : "login", params: { method: method ?? "unknown" } };
}
