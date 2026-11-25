import type { PasskeyGetRequest } from "react-native-passkey";
import { apiRequest } from "@/api";
import type { PasskeyAssertionJson } from "./passkey";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  created_at: number;
}

export type LoginResult =
  | { kind: "tokens"; access: string; refresh: string; user: AuthUser }
  | { kind: "2fa"; method: "totp" | "email"; challengeToken: string };

interface TokenBody {
  ok: true;
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}
interface TwoFaBody {
  ok: true;
  requires_2fa: true;
  method: "totp" | "email";
  challenge_token: string;
}

export async function mobileLogin(email: string, password: string): Promise<LoginResult> {
  const res = await apiRequest<TokenBody | TwoFaBody>("/api/auth/mobile/login", {
    method: "POST",
    body: { email, password },
    skipRefresh: true,
  });
  if ("requires_2fa" in res && res.requires_2fa) {
    return { kind: "2fa", method: res.method, challengeToken: res.challenge_token };
  }
  const t = res as TokenBody;
  return { kind: "tokens", access: t.access_token, refresh: t.refresh_token, user: t.user };
}

/**
 * `codeVerifier` is the PKCE secret kept back when the flow started. The server
 * refuses any code it minted with a challenge unless this matches, so omitting
 * it is only valid for a flow that began before PKCE existed.
 */
export async function mobileOAuthExchange(code: string, codeVerifier?: string): Promise<LoginResult> {
  const res = await apiRequest<TokenBody | TwoFaBody>("/api/auth/mobile/oauth/exchange", {
    method: "POST",
    body: codeVerifier ? { code, code_verifier: codeVerifier } : { code },
    skipRefresh: true,
  });
  if ("requires_2fa" in res && res.requires_2fa) {
    return { kind: "2fa", method: res.method, challengeToken: res.challenge_token };
  }
  const t = res as TokenBody;
  return { kind: "tokens", access: t.access_token, refresh: t.refresh_token, user: t.user };
}

/**
 * `authorizationCode` rides along so the server can obtain Apple's refresh
 * token, the credential it must revoke when the account is deleted (App Store
 * guideline 5.1.1(v)). Optional: the sign-in works without it.
 */
export async function mobileAppleLogin(
  identityToken: string,
  name: string,
  authorizationCode: string | null = null,
): Promise<LoginResult> {
  const res = await apiRequest<TokenBody | TwoFaBody>("/api/auth/mobile/apple", {
    method: "POST",
    body: { identity_token: identityToken, name, authorization_code: authorizationCode ?? undefined },
    skipRefresh: true,
  });
  if ("requires_2fa" in res && res.requires_2fa) {
    return { kind: "2fa", method: res.method, challengeToken: res.challenge_token };
  }
  const t = res as TokenBody;
  return { kind: "tokens", access: t.access_token, refresh: t.refresh_token, user: t.user };
}

/** The challenge is the same one the browser flow uses; only the verify route differs. */
export async function mobilePasskeyOptions(): Promise<{ challengeToken: string; options: PasskeyGetRequest }> {
  const res = await apiRequest<{ ok: true; challenge_token: string; options: PasskeyGetRequest }>(
    "/api/auth/passkey/options",
    { method: "POST", body: {}, skipRefresh: true },
  );
  return { challengeToken: res.challenge_token, options: res.options };
}

/** Always tokens: a passkey is already two factors, so this route has no 2FA step. */
export async function mobilePasskeyVerify(
  challengeToken: string,
  response: PasskeyAssertionJson,
): Promise<{ access: string; refresh: string; user: AuthUser }> {
  const res = await apiRequest<TokenBody>("/api/auth/mobile/passkey/verify", {
    method: "POST",
    body: { challenge_token: challengeToken, response },
    skipRefresh: true,
  });
  return { access: res.access_token, refresh: res.refresh_token, user: res.user };
}

export async function mobile2fa(
  challengeToken: string,
  code: string,
  isRecovery: boolean,
): Promise<{ access: string; refresh: string; user: AuthUser }> {
  const res = await apiRequest<TokenBody>("/api/auth/mobile/2fa", {
    method: "POST",
    body: { challenge_token: challengeToken, code, is_recovery: isRecovery },
    skipRefresh: true,
  });
  return { access: res.access_token, refresh: res.refresh_token, user: res.user };
}

export async function mobileRefresh(refresh: string): Promise<{ access: string; refresh: string }> {
  const res = await apiRequest<{ ok: true; access_token: string; refresh_token: string }>(
    "/api/auth/mobile/refresh",
    { method: "POST", body: { refresh_token: refresh }, skipRefresh: true, omitAuth: true },
  );
  return { access: res.access_token, refresh: res.refresh_token };
}

/**
 * Revoke this device's session on the server, together with the linked session
 * the iOS Files extension holds. The refresh token is the credential because the
 * access token may already be expired at sign-out. Callers treat it as
 * best-effort: sign-out must complete offline too.
 */
export async function mobileLogout(refresh: string, signal?: AbortSignal): Promise<void> {
  await apiRequest<{ ok: true }>("/api/auth/mobile/logout", {
    method: "POST",
    body: { refresh_token: refresh },
    skipRefresh: true,
    omitAuth: true,
    signal,
  });
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await apiRequest<{ ok: true; user: AuthUser }>("/api/me");
  return res.user;
}

/**
 * Whether email + password sign-up is open (switched from the admin
 * dashboard). The sign-up screen hides its form when this is false; the API
 * refuses the signup either way.
 */
export async function fetchEmailSignupOpen(signal?: AbortSignal): Promise<boolean> {
  const res = await apiRequest<{ ok: true; email_signup?: unknown }>("/api/auth/signup", {
    skipRefresh: true,
    omitAuth: true,
    signal,
  });
  return res.email_signup !== false;
}

export async function mobileSignup(name: string, email: string, password: string): Promise<{ email: string }> {
  const res = await apiRequest<{ ok: true; requires_verification: true; email: string }>(
    "/api/auth/mobile/signup",
    // `terms` is required by the endpoint, which records the acceptance against
    // the new user row. The sign-up screen gates submission on its checkbox, so
    // reaching here means the box was ticked.
    { method: "POST", body: { name, email, password, terms: true }, skipRefresh: true },
  );
  return { email: res.email };
}

export async function mobileVerifyEmail(
  email: string,
  code: string,
): Promise<{ access: string; refresh: string; user: AuthUser }> {
  const res = await apiRequest<TokenBody>("/api/auth/mobile/signup/verify", {
    method: "POST",
    body: { email, code },
    skipRefresh: true,
  });
  return { access: res.access_token, refresh: res.refresh_token, user: res.user };
}
