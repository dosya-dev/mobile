import { Platform } from "react-native";
import { useAuthStore } from "@/auth/authStore";
import type { LastMethod } from "@/auth/lastMethod";
import { OAuthButton } from "@/ui/OAuthButton";

/**
 * Apple first on iOS, Google first everywhere else, GitHub last on both.
 *
 * App Review guideline 4.8 is about PARITY: wherever a third-party login is
 * offered, Sign in with Apple has to be offered as an equivalent option. The
 * 1.0.0 (16) rejection happened because login.tsx had the Apple button and
 * signup.tsx did not - a reviewer creating an account never saw the login
 * screen, so on the only auth screen they used there were two third-party
 * providers and no Apple.
 *
 * That is why the list lives here rather than being spelled out twice. There
 * is one ordering, one provider set, and no way for one screen to drift from
 * the other again.
 */
type Provider = "google" | "github" | "apple";

/** Read per render, not once at module load - a module-level constant would
 * bake in whatever Platform.OS said when this file was first imported, which
 * is fine in a real build and untestable in either direction. */
const order = (): Provider[] =>
  Platform.OS === "ios" ? ["apple", "google", "github"] : ["google", "apple", "github"];

export function AuthProviders({ lastMethod }: { lastMethod?: LastMethod | null }) {
  const signInWithOAuth = useAuthStore((s) => s.signInWithOAuth);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);

  return (
    <>
      {order().map((provider) => (
          <OAuthButton
            key={provider}
            provider={provider}
            testID={`oauth-${provider}`}
            lastUsed={lastMethod === provider}
            // signInWithApple picks the native sheet on iOS and the browser
            // flow elsewhere; the other two are always the browser flow.
            onPress={() => {
              if (provider === "apple") void signInWithApple();
              else void signInWithOAuth(provider);
            }}
          />
      ))}
    </>
  );
}
