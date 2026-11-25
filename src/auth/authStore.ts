import { Platform } from "react-native";
import { create } from "zustand";
import { setTokenProvider, setRefreshHandler, ApiError, type RefreshOutcome } from "@/api";
import { queryClient } from "@/lib/queryClient";
import { t } from "@/lib/i18n";
import { saveTokens, loadTokens, clearTokens, saveUser, loadUser } from "./tokenStore";
import { mobileLogin, mobile2fa, mobileRefresh, mobileLogout, fetchMe, mobileSignup, mobileVerifyEmail, mobileOAuthExchange, mobileAppleLogin, mobilePasskeyOptions, mobilePasskeyVerify, type AuthUser } from "./api";
import { setLastMethod } from "./lastMethod";
import { runOAuthBrowserFlow, type BrowserOAuthProvider } from "./oauth";
import { getPasskeyAssertion, isPasskeyCancelled, passkeyFailureMessage } from "./passkey";
import { loadPendingOAuth, clearPendingOAuth } from "./pendingOAuth";
import { identifyBilling, resetBilling } from "@/billing/revenuecat";
import { relinkFilesProvider, unlinkFilesProvider } from "@/filesProvider/link";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

/** The slice of expo-apple-authentication the store touches (also the test seam). */
export interface AppleAuthModule {
  AppleAuthenticationScope: { FULL_NAME: number; EMAIL: number };
  signInAsync(opts: { requestedScopes: number[] }): Promise<{
    identityToken: string | null;
    /** Exchanged server-side for the refresh token Apple's revoke API needs at account deletion. */
    authorizationCode?: string | null;
    fullName: { givenName?: string | null; familyName?: string | null } | null;
  }>;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  pending2fa: { method: "totp" | "email"; challengeToken: string } | null;
  pendingVerificationEmail: string | null;
  error: string | null;
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  verifyEmail: (code: string) => Promise<void>;
  signInWithOAuth: (provider: BrowserOAuthProvider) => Promise<void>;
  /** Exchange a one-time OAuth code for tokens. Called by signInWithOAuth and,
   * when Android hands the redirect to the app instead of the in-app browser,
   * by the dosya://auth/callback route. Idempotent per code.
   *
   * `state` is the nonce the callback echoed back. It is checked here, for both
   * delivery paths, against the one this app generated when it opened the
   * browser - a callback that cannot produce it did not answer our request. */
  completeOAuthCode: (code: string, state?: string | null) => Promise<void>;
  /** Sign in with Apple. On iOS this is the NATIVE sheet (identity token
   * verified server-side); everywhere else it falls back to the browser flow
   * against /api/auth/mobile/apple, because expo-apple-authentication has no
   * Android implementation and the provider list is the same on both
   * platforms (guideline 4.8).
   * `moduleOverride` is a test seam - the expo module only exists in real builds. */
  signInWithApple: (moduleOverride?: AppleAuthModule) => Promise<void>;
  /** Native passkey sheet, then tokens. Dismissing the sheet is not an error. */
  signInWithPasskey: () => Promise<void>;
  submit2fa: (code: string, isRecovery: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

// How long sign-out waits for the server to revoke the session before giving up.
const LOGOUT_TIMEOUT_MS = 4000;

// In-memory access token, read synchronously by the client's token provider.
let accessToken: string | null = null;
let refreshToken: string | null = null;

// The provider whose browser flow is currently open, so the deep-link fallback
// can still record lastMethod - the callback URL doesn't name the provider.
let inFlightOAuthProvider: BrowserOAuthProvider | null = null;
// The last one-time code successfully exchanged. On Android BOTH the in-app
// browser result and the dosya:// deep link can deliver the same code; the
// second exchange would fail (codes are single-use) and surface a bogus error.
// A single value rather than a growing Set: the two deliveries race within
// seconds of each other, and starting a new sign-in clears it anyway.
let lastConsumedOAuthCode: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * The account a sign-in just replaced, if it replaced a different one. The
 * shell reads it to purge that account's data (see takeAccountSwitch).
 */
let accountSwitchedFrom: string | null = null;

/**
 * Read-and-clear the id of an account that a sign-in displaced.
 *
 * Not purging on sign-OUT alone is deliberate: an unreadable token store looks
 * exactly like a sign-out and must not cost the user their backup ledger (see
 * shouldPurgeOnSignOut). Detecting the switch here instead keeps the "one
 * account never inherits another's data" guarantee, and covers a case the
 * sign-out hook never could - the app killed while signed in, so no transition
 * was ever observed.
 */
export function takeAccountSwitch(): string | null {
  const previous = accountSwitchedFrom;
  accountSwitchedFrom = null;
  return previous;
}

// `user` is persisted alongside the tokens on every sign-in so an offline start
// has a profile to show. The refresh path omits it - it returns tokens only.
async function applyTokens(access: string, refresh: string, user?: AuthUser): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  await saveTokens({ access, refresh });
  if (user) {
    // Compare before overwriting: this is the one moment both account ids are
    // in hand. An unreadable store reports no switch - the same fail-safe
    // direction as everywhere else here, since a false switch would purge a
    // live account's data.
    let previous: AuthUser | null = null;
    try { previous = await loadUser<AuthUser>(); } catch { /* unreadable - assume no switch */ }
    if (previous && previous.id !== user.id) {
      accountSwitchedFrom = previous.id;
      // SYNCHRONOUSLY, here, and not left to purgeAccountData: that runs from
      // an effect after the store has already flipped to the new user, and
      // reaches queryClient.clear() only after a dozen awaited teardown steps
      // (background jobs, ledger, SQLite). Every one of those is a frame in
      // which the new account's screens read the OLD account's cached
      // responses - which is what put another user's storage allowance above
      // the account card in Settings. Nothing that outlives this call may
      // serve a response fetched for a different account.
      queryClient.clear();
    }
    await saveUser(user);
    // A fresh sign-in is a new server session; the iOS Files extension's
    // linked session (a child of the previous one) is dead with it. Best-effort
    // and not awaited: Files access never blocks sign-in.
    void relinkFilesProvider(user.id);
  }
}

/**
 * A failed auth call only proves the session is dead when the SERVER rejected
 * the credential. Anything else - offline, 5xx, a timeout - is the transport
 * talking. Treating those as a dead session used to delete a 60-day refresh
 * token and drop the user at the login screen over one dropped packet.
 */
function isCredentialRejection(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

/**
 * Why the last session teardown happened. A spurious logout also triggers
 * purgeAccountData() (see app/_layout.tsx), which discards the upload queue and
 * backup ledger - so when a user reports "it logged me out mid-backup" this is
 * the difference between a real credential rejection and a plumbing bug.
 * Read it back with `getLastSessionDropReason()`.
 */
export type SessionDropReason = "server-rejected-refresh" | "explicit-sign-out";
export interface SessionDrop {
  reason: SessionDropReason;
  at: number;
}
let lastSessionDrop: SessionDrop | null = null;

export function getLastSessionDropReason(): SessionDrop | null {
  return lastSessionDrop;
}

/** Tear down the session locally. Only for a credential the server rejected. */
async function dropSession(reason: SessionDropReason = "server-rejected-refresh"): Promise<void> {
  lastSessionDrop = { reason, at: Date.now() };
  // Deliberately loud: this is the event that costs a user their backup progress.
  console.warn(`[auth] session dropped: ${reason}`);
  // Same reason as in applyTokens: the purge that follows is asynchronous, and
  // whoever signs in next must not be able to read this account's responses in
  // the meantime.
  queryClient.clear();
  accessToken = null;
  refreshToken = null;
  await clearTokens();
  // The server has already killed the Files extension's linked session along
  // with this one; forget it locally too, exactly as an explicit sign-out does.
  void unlinkFilesProvider(null);
  useAuthStore.setState({ status: "signedOut", user: null });
}

// Register the client seams once, at module load.
setTokenProvider(() => accessToken);

// Single-flight refresh: concurrent 401s share one refresh round-trip.
let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * Run (or join) the in-flight refresh. Exported so non-`apiRequest` transports -
 * notably the binary upload task in src/upload/runner.ts, which cannot use the
 * client's transparent retry - can still recover from an expired access token
 * instead of failing the whole backup.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  return runRefresh();
}

function runRefresh(): Promise<RefreshOutcome> {
  if (refreshing) return refreshing;
  // NOTE: the reset must be a `.finally()` chained onto the promise, not a
  // `try/finally` inside the async IIFE below. When `refreshToken` is falsy,
  // the IIFE returns without ever hitting an `await`, so it runs to
  // completion synchronously - a `finally` block inside it would fire
  // *during* the evaluation of this assignment's right-hand side, before
  // `refreshing = ...` itself has run, and the assignment would immediately
  // clobber that reset back to a resolved (stale) promise, wedging the
  // single-flight state forever. `Promise.prototype.finally` always defers
  // its callback to a microtask - even for an already-settled promise - so
  // chaining it here guarantees the reset happens after this assignment.
  refreshing = (async (): Promise<RefreshOutcome> => {
    // SecureStore, not the in-memory copy, is the shared truth.
    //
    // The backup task runs in its OWN JS context, with its own module-level
    // tokens and its own single-flight guard - so when it refreshes, the
    // server rotates the row and THIS context's in-memory token silently
    // becomes dead. Presenting it earns a real 401, and the store used to read
    // that as a rejected credential and sign the user out of a live 60-day
    // session. Reading disk first means each context presents whatever was
    // most recently issued, whoever obtained it.
    let persisted: Awaited<ReturnType<typeof loadTokens>> = null;
    try { persisted = await loadTokens(); } catch { /* disk unreadable: fall back to memory */ }
    if (persisted?.refresh && persisted.refresh !== refreshToken) {
      accessToken = persisted.access;
      refreshToken = persisted.refresh;
    }

    // No token IN MEMORY proves nothing about the server's view of the
    // session - the store may simply not have hydrated yet (a background
    // task starts a fresh JS context and never mounts the UI that calls
    // hydrate()). Reporting "rejected" here made a 401 in that window look
    // like a server-rejected credential and tore down a live 60-day session.
    // "unavailable" keeps the tokens and lets the next request retry.
    if (!refreshToken) return "unavailable";

    // At most two attempts: the retry exists only to pick up a token another
    // context rotated in while this call was in flight. A genuinely dead token
    // must reach dropSession rather than loop.
    let presented: string = refreshToken;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const next = await mobileRefresh(presented);
        await applyTokens(next.access, next.refresh);
        return "refreshed";
      } catch (e) {
        // Only a 401 means the server rejected the refresh token. On anything
        // else the session is still good and the next request can retry - so
        // keep it rather than forcing a re-login.
        if (!isCredentialRejection(e)) return "unavailable";

        // A 401 for a token that disk has ALREADY moved past is not a dead
        // session - it is this context having raced another one. Adopt the
        // newer token and try that before concluding anything.
        let fresh: Awaited<ReturnType<typeof loadTokens>> = null;
        try { fresh = await loadTokens(); } catch { /* fall through to the drop */ }
        if (attempt === 0 && fresh?.refresh && fresh.refresh !== presented) {
          accessToken = fresh.access;
          refreshToken = fresh.refresh;
          presented = fresh.refresh;
          continue;
        }
        await dropSession();
        return "rejected";
      }
    }
    return "unavailable";
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Register the client seam once, at module load.
setRefreshHandler(runRefresh);

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain");
}

type BeforeSignOutHook = () => Promise<void>;
const beforeSignOutHooks = new Set<BeforeSignOutHook>();
const BEFORE_SIGN_OUT_TIMEOUT_MS = 3000;

/**
 * Run `fn` at the start of an explicit sign-out, while the access token is
 * still valid. Returns the unsubscribe. Push unregistration lives here because
 * DELETE /api/notifications/push/register-device is authenticated: by the time
 * the status flips to signedOut the request could no longer be made.
 */
export function onBeforeSignOut(fn: BeforeSignOutHook): () => void {
  beforeSignOutHooks.add(fn);
  return () => { beforeSignOutHooks.delete(fn); };
}

async function runBeforeSignOutHooks(): Promise<void> {
  if (beforeSignOutHooks.size === 0) return;
  const all = Promise.allSettled([...beforeSignOutHooks].map((h) => h()));
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, BEFORE_SIGN_OUT_TIMEOUT_MS))]);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  pending2fa: null,
  pendingVerificationEmail: null,
  error: null,

  hydrate: async () => {
    // A store we could not READ is not the same as a session we do not have.
    // iOS keychain entries are unreadable while the device is locked, which a
    // background launch runs straight into, and this call used to be outside
    // any try - so it either threw (leaving the app on the loading screen
    // forever) or came back empty and looked exactly like a sign-out.
    //
    // Either way the session on disk is untouched and still live, so the cost
    // landed on the backup: the shell purges everything account-scoped on the
    // transition to signedOut, clearing the ledger and resetting backup
    // settings. Come up signed out so the app is usable, but record NO drop -
    // shouldPurgeOnSignOut is what keeps the purge from running - and leave
    // the stored tokens alone so the next start signs back in.
    let stored: Awaited<ReturnType<typeof loadTokens>> = null;
    try {
      stored = await loadTokens();
    } catch {
      set({ status: "signedOut", user: null });
      return;
    }
    if (!stored) {
      set({ status: "signedOut", user: null });
      return;
    }
    accessToken = stored.access;
    refreshToken = stored.refresh;
    try {
      const user = await fetchMe(); // triggers auto-refresh if the access token expired
      await saveUser(user);
      set({ status: "signedIn", user });
    } catch (e) {
      if (isCredentialRejection(e)) {
        await dropSession();
        return;
      }
      // Transient failure (no signal, server blip): the stored session is still
      // valid. Come up signed in on the last known profile and let requests
      // retry, instead of wiping a session that was never rejected.
      set({ status: "signedIn", user: await loadUser<AuthUser>() });
    }
  },

  signIn: async (email, password) => {
    set({ error: null });
    try {
      const res = await mobileLogin(email, password);
      if (res.kind === "2fa") {
        set({ status: "signedOut", pending2fa: { method: res.method, challengeToken: res.challengeToken } });
        return;
      }
      await applyTokens(res.access, res.refresh, res.user);
      await setLastMethod("password");
      set({ status: "signedIn", user: res.user, pending2fa: null, error: null });
    } catch (e) {
      set({ status: "signedOut", error: errMessage(e) });
    }
  },

  signUp: async (name, email, password) => {
    set({ error: null });
    try {
      const res = await mobileSignup(name.trim(), email.trim(), password);
      set({ pendingVerificationEmail: res.email, error: null });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  verifyEmail: async (code) => {
    const email = get().pendingVerificationEmail;
    if (!email) { set({ error: t("common.error.sessionExpiredPleaseSignUpAgain") }); return; }
    set({ error: null });
    try {
      const res = await mobileVerifyEmail(email, code.trim());
      await applyTokens(res.access, res.refresh, res.user);
      await setLastMethod("password");
      set({ status: "signedIn", user: res.user, pendingVerificationEmail: null, pending2fa: null, error: null });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  signInWithApple: async (moduleOverride) => {
    set({ error: null });
    // Android (and anything that is not iOS) has no native Apple module, so it
    // takes the same auth-session route Google and GitHub take. Routed through
    // signInWithOAuth rather than duplicated here so the PKCE pair, the nonce
    // check and the single-use-code guard stay in ONE place.
    if (Platform.OS !== "ios" && !moduleOverride) {
      await get().signInWithOAuth("apple");
      return;
    }
    let identityToken: string | null = null;
    let authorizationCode: string | null = null;
    let name = "";
    try {
      // Loaded lazily: the native module only exists in builds that include it
      // (and would crash an Android import at boot if loaded statically).
      const Apple = moduleOverride ?? (await import("expo-apple-authentication"));
      const cred = await Apple.signInAsync({
        requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
      });
      identityToken = cred.identityToken;
      authorizationCode = cred.authorizationCode ?? null;
      // Apple provides the name ONLY on the very first authorization.
      name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ");
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ERR_REQUEST_CANCELED") return; // user dismissed the sheet - not an error
      set({ error: t("common.error.appleSignInIsUnavailableOnThisDevice") });
      return;
    }
    if (!identityToken) {
      set({ error: t("common.error.appleSignInFailedPleaseTryAgain") });
      return;
    }
    try {
      const res = await mobileAppleLogin(identityToken, name, authorizationCode);
      await setLastMethod("apple");
      if (res.kind === "2fa") {
        set({ status: "signedOut", pending2fa: { method: res.method, challengeToken: res.challengeToken } });
        return;
      }
      await applyTokens(res.access, res.refresh, res.user);
      set({ status: "signedIn", user: res.user, pending2fa: null, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : t("common.error.appleSignInFailed") });
    }
  },

  signInWithPasskey: async () => {
    set({ error: null });
    try {
      const { challengeToken, options } = await mobilePasskeyOptions();
      const response = await getPasskeyAssertion(options);
      const res = await mobilePasskeyVerify(challengeToken, response);
      await applyTokens(res.access, res.refresh, res.user);
      await setLastMethod("passkey");
      set({ status: "signedIn", user: res.user, pending2fa: null, error: null });
    } catch (e) {
      if (isPasskeyCancelled(e)) return;
      set({ status: "signedOut", error: passkeyFailureMessage(e, "sign-in.error.weCouldNotSignYouInWithThatPasskeyTryAgain", t) });
    }
  },

  signInWithOAuth: async (provider) => {
    set({ error: null });
    inFlightOAuthProvider = provider;
    lastConsumedOAuthCode = null; // a new attempt supersedes any earlier code
    const flow = await runOAuthBrowserFlow(provider);
    if (flow.kind === "cancel") return; // user closed the browser - no error
    if (flow.kind === "error") { set({ error: flow.message }); return; }
    await get().completeOAuthCode(flow.code, flow.state);
  },

  // Shared by signInWithOAuth and the dosya://auth/callback deep-link route.
  completeOAuthCode: async (code, state) => {
    if (lastConsumedOAuthCode === code) return; // both paths can fire for one login
    set({ error: null });

    // The binding that makes an injected deep link inert. Anyone can fire
    // dosya://auth/callback?code=… - another installed app may claim the
    // scheme, and a web page can simply navigate to it - so without this the
    // app would happily exchange a code minted for somebody ELSE's account and
    // silently switch the user onto it, backups and all.
    //
    // Fails closed, and NO PENDING FLOW IS ALSO A FAILURE. This used to read
    // `if (pending && state !== pending.nonce)`, which skipped the check
    // entirely whenever nothing was recorded - and "nothing recorded" is the
    // resting state of an app that is not mid-sign-in, i.e. exactly the
    // condition an attacker gets to choose. Server-side PKCE does not cover
    // that gap either: the challenge is supplied by whoever starts the flow
    // (GET /api/auth/mobile/google reads it off the query string), so an
    // attacker simply starts a challenge-less one, and the code it mints has
    // a NULL code_challenge that consumeMobileOAuthCode redeems without a
    // verifier. Fire the deep link at an idle app and it adopts the
    // attacker's account, backups and all - the precise attack the PKCE work
    // was written to stop.
    //
    // The cost is that a cold start which lost its SecureStore record fails
    // the sign-in instead of completing it. That is a retry; the alternative
    // is an account swap.
    //
    // This requires the API deployed before this build ships - it is what
    // echoes the nonce back - which is the normal order anyway: the server
    // change is backward compatible, EAS is not fast.
    const pending = await loadPendingOAuth();
    if (!pending || state !== pending.nonce) {
      await clearPendingOAuth();
      set({ error: t("common.error.thatSignInLinkDidnTComeFromThisAppPleaseTrySigningIn") });
      return;
    }

    try {
      const res = await mobileOAuthExchange(code, pending.verifier);
      // Mark consumed as soon as the SERVER accepted it - including the 2FA
      // branch, where the code is spent even though sign-in isn't finished.
      // A throw leaves it unmarked, so a failed exchange stays retryable.
      lastConsumedOAuthCode = code;
      // The verifier is single-use and the flow is over either way; a 2FA
      // branch still spent the code. Leaving it behind would let a later,
      // unrelated callback borrow it.
      await clearPendingOAuth();
      if (inFlightOAuthProvider) await setLastMethod(inFlightOAuthProvider);
      if (res.kind === "2fa") {
        set({ status: "signedOut", pending2fa: { method: res.method, challengeToken: res.challengeToken } });
        return;
      }
      await applyTokens(res.access, res.refresh, res.user);
      set({ status: "signedIn", user: res.user, pending2fa: null, error: null });
    } catch (e) {
      set({ error: errMessage(e) });
    } finally {
      inFlightOAuthProvider = null;
    }
  },

  submit2fa: async (code, isRecovery) => {
    const pending = get().pending2fa;
    if (!pending) { set({ error: t("common.error.sessionExpiredPleaseSignInAgain") }); return; }
    set({ error: null });
    try {
      const res = await mobile2fa(pending.challengeToken, code, isRecovery);
      await applyTokens(res.access, res.refresh, res.user);
      set({ status: "signedIn", user: res.user, pending2fa: null, error: null });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  signOut: async () => {
    lastSessionDrop = { reason: "explicit-sign-out", at: Date.now() };
    // Anything that needs the session it is about to lose - today, telling
    // the server to stop pushing to this phone. Bounded and best-effort like
    // the logout call below: nothing here may keep a user signed in.
    await runBeforeSignOutHooks();
    // Tell the server first, while the refresh token is still in hand. Until
    // this existed a signed-out phone's session stayed valid for its full 60
    // days, and the linked Files-app session with it. Bounded and best-effort:
    // an offline sign-out still signs out.
    // Disk first: the background upload context may have rotated the token
    // since this context last looked, and a stale one would revoke nothing.
    let presented = refreshToken;
    try {
      presented = (await loadTokens())?.refresh ?? presented;
    } catch {
      /* unreadable store - fall back to the in-memory token */
    }
    // Remove the Files location now rather than only in the purge that follows
    // the status change: the purge is skipped when the session drop is unproven,
    // and an explicit sign-out is never unproven.
    void unlinkFilesProvider(null);
    if (presented) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), LOGOUT_TIMEOUT_MS);
      try {
        await mobileLogout(presented, abort.signal);
      } catch {
        /* offline, 5xx, or an older server without the route - sign out anyway */
      } finally {
        clearTimeout(timer);
      }
    }
    accessToken = null;
    refreshToken = null;
    // Before the status flip, so no render ever sees a signed-out shell over
    // this account's cached data - and, more to the point, so a sign-in that
    // follows immediately cannot read it either. clearTokens() also drops the
    // stored user, so the next sign-in sees no previous account and reports no
    // switch; this is the only chance to drop the cache on this path.
    queryClient.clear();
    await clearTokens();
    set({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
    // Fire-and-forget: store billing must never hold up or fail a sign-out.
    billingSafely(() => resetBilling());
  },
}));

/** Run a billing call without letting it block or throw into auth. */
function billingSafely(run: () => Promise<void>): void {
  try {
    run().catch((e) => console.warn("[billing] call failed", e));
  } catch (e) {
    console.warn("[billing] call failed", e);
  }
}

// One hook point for every sign-in path (password, 2FA, OAuth, Apple, passkey,
// signup, cold-start restore): whenever the signed-in user id changes, tell
// RevenueCat who it is.
useAuthStore.subscribe((state, prev) => {
  const id = state.user?.id;
  if (id && id !== prev.user?.id) billingSafely(() => identifyBilling(id));
});
