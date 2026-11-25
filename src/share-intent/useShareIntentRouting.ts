import { useEffect } from "react";
import { useAuthStore } from "@/auth/authStore";
import { startShareIntentListener } from "./listener";
import { useShareIntentStore } from "./store";

/**
 * The receiving half of the OS's "Open with" chooser and share sheet. Mounted
 * once, from the root layout. On Android the files arrive via the native
 * listener below; on iOS app/+native-intent.ts parks them in the same store
 * from the incoming file:// URL.
 *
 * It only receives. Opening the destination picker is ShareIntentRedirect's
 * job, rendered beside the signed-in <Stack>: a share can land during a cold
 * start, while the user is signed out, or while AppLockGate / OnboardingGate
 * / WorkspaceGate still render placeholders - and in all three no navigator
 * exists to push onto. The store holds the payload until one does.
 *
 * Do NOT move the push back up here. From the root layout the only navigator
 * in sight during those gates is expo-router's internal `__root` stack, whose
 * single screen IS this layout. useRootNavigationState() reports that stack's
 * key, so a "has the navigator mounted?" check passes, and router.push() then
 * pushes a second copy of the root layout - whose own copy of this hook pushes
 * again. On a cold start from the Files app that loop hit React's update-depth
 * limit and took Hermes down with it (Sentry 155694028, 1.0.5 build 42).
 */
export function useShareIntentRouting(): void {
  const status = useAuthStore((s) => s.status);

  useEffect(() => startShareIntentListener(), []);

  useEffect(() => {
    // Account-scoped, like everything else purgeAccountData drops on sign-out: a
    // file parked by one account must never surface in the next one's session.
    if (status === "signedOut") useShareIntentStore.getState().clear();
  }, [status]);
}
