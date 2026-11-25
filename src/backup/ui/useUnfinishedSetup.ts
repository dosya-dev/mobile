import { useEffect, useState } from "react";
import { useAuthStore } from "@/auth/authStore";
import { readOnboarding, type OnboardingState } from "@/onboarding/onboardingState";

export interface UnfinishedSetup {
  photoPermission: OnboardingState["photoPermission"];
}

/**
 * "Not now" is honoured, not forgotten. A skipped onboarding surfaces on the
 * Backup tab as one row in the attention list rather than a nag; resuming
 * clears the skip so OnboardingGate picks the flow back up (see the resume
 * wiring in app/(tabs)/backup.tsx and onboardingRefresh.ts).
 *
 * Null while signed out, while still reading, once completed, or when the
 * flow was never skipped.
 */
export function useUnfinishedSetup(): UnfinishedSetup | null {
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void readOnboarding(accountId).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  if (!accountId || !state) return null;
  if (state.completedAt !== null || state.skippedAt === null) return null;
  return { photoPermission: state.photoPermission };
}
