import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { useT } from "@/lib/i18n";

/**
 * Fallback landing point for `dosya://auth/callback?code=…`.
 *
 * `WebBrowser.openAuthSessionAsync` is *supposed* to intercept this redirect and
 * hand the URL straight back to runOAuthBrowserFlow. On Android it often
 * doesn't: Chrome resolves the custom scheme by firing an Intent, so the OS
 * delivers it to MainActivity as an ordinary deep link instead. Without a route
 * at this exact path expo-router renders "Unmatched Route" and the one-time code
 * is lost, stranding the user after a successful Google sign-in.
 *
 * Note the directory is `app/auth/`, not `app/(auth)/` - the parenthesised one
 * is a route *group* and contributes nothing to the URL, which is why
 * /auth/callback matched nothing before.
 *
 * completeOAuthCode is idempotent per code, so it's harmless when the browser
 * session also delivered the same code.
 */
export default function OAuthCallback() {
  const t = useT();
  // `state` is the nonce this app generated before opening the browser, echoed
  // back by the callback. completeOAuthCode refuses the exchange without it -
  // this route is the path an injected deep link would take, so forwarding it
  // is what makes the check reachable at all.
  const { code, state } = useLocalSearchParams<{ code?: string; state?: string }>();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const completeOAuthCode = useAuthStore((s) => s.completeOAuthCode);
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (typeof code === "string" && code.length > 0) {
      void completeOAuthCode(code, typeof state === "string" ? state : null).catch(() => setFailed(true));
    } else {
      setFailed(true);
    }
  }, [code, state, completeOAuthCode]);

  // Leave as soon as the exchange lands. On success the root guard would also
  // route us, but this screen sits outside its control so it must move itself.
  useEffect(() => {
    if (status === "signedIn") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (failed || (error && status === "signedOut")) {
      const timer = setTimeout(() => router.replace("/(auth)/login"), 1200);
      return () => clearTimeout(timer);
    }
  }, [failed, error, status, router]);

  const message = failed
    ? t("sign-in.label.signInLinkWasIncompleteReturningToSignIn")
    : error && status === "signedOut"
      ? error
      : t("sign-in.label.finishingSignIn");

  return (
    <View testID="oauth-callback" className="flex-1 items-center justify-center gap-4 bg-background px-8">
      {!failed && !error ? <ActivityIndicator /> : null}
      <Text className="text-center text-base text-foreground">{message}</Text>
    </View>
  );
}
