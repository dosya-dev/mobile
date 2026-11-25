import { useState } from "react";
import { useAuthStore } from "@/auth/authStore";
import type { LastMethod } from "@/auth/lastMethod";
import { isPasskeySupported } from "@/auth/passkey";
import { OAuthButton } from "@/ui/OAuthButton";

/**
 * Sign-in only, not in AuthProviders: that list is shared with sign-up, and a
 * passkey cannot exist before the account does.
 */
export function PasskeySignIn({ lastMethod }: { lastMethod?: LastMethod | null }) {
  const signInWithPasskey = useAuthStore((s) => s.signInWithPasskey);
  const [busy, setBusy] = useState(false);

  if (!isPasskeySupported()) return null;

  return (
    <OAuthButton
      provider="passkey"
      testID="passkey-signin"
      lastUsed={lastMethod === "passkey"}
      disabled={busy}
      onPress={() => {
        setBusy(true);
        void signInWithPasskey().finally(() => setBusy(false));
      }}
    />
  );
}
