import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { API_BASE_URL } from "@/api";
import { t } from "@/lib/i18n";
import { createPkcePair } from "./pkce";
import { savePendingOAuth } from "./pendingOAuth";

// The backend deep-links here after the provider round-trip: dosya://auth/callback?code=…&state=…
const RETURN_URL = "dosya://auth/callback";

/**
 * The providers whose sign-in runs in an auth session rather than natively.
 * Apple is in this list for ANDROID only - iOS has expo-apple-authentication
 * and must use it (a web flow on iOS would not satisfy guideline 4.8, and
 * Apple's own HIG requires the native sheet where it exists). authStore's
 * signInWithApple is what picks between the two.
 */
export type BrowserOAuthProvider = "google" | "github" | "apple";

export type OAuthFlowResult =
  | { kind: "code"; code: string; state: string | null }
  | { kind: "cancel" }
  | { kind: "error"; message: string };

/**
 * Open the backend OAuth start route in an auth session, wait for the dosya://
 * redirect, and pull the one-time code out of it. The caller exchanges the code
 * for a token pair.
 *
 * Before opening anything this generates a PKCE pair and a callback nonce and
 * records them (see pendingOAuth). Only the challenge and the nonce go out on
 * the URL; the verifier stays on the device and is presented at exchange time.
 *
 * The nonce is NOT checked here. Both this path and the deep-link route in
 * app/auth/callback.tsx converge on completeOAuthCode, so the check lives there
 * - one implementation, no way for a delivery path to skip it.
 */
export async function runOAuthBrowserFlow(provider: BrowserOAuthProvider): Promise<OAuthFlowResult> {
  const pair = await createPkcePair();
  await savePendingOAuth(pair);

  const params = new URLSearchParams({ state: pair.nonce, code_challenge: pair.challenge });
  const startUrl = `${API_BASE_URL}/api/auth/mobile/${provider}?${params}`;

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(startUrl, RETURN_URL);
  } catch {
    return { kind: "error", message: t("common.error.couldNotOpenTheSignInPage") };
  }
  if (result.type !== "success" || !result.url) return { kind: "cancel" };

  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === "string" ? queryParams.code : null;
  const state = typeof queryParams?.state === "string" ? queryParams.state : null;
  if (!code) return { kind: "error", message: t("common.description.signInWasInterruptedPleaseTryAgain") };
  return { kind: "code", code, state };
}
