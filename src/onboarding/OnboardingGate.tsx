import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaces } from "@/files/hooks";
import { GateScreen } from "@/ui/GateScreen";
import { readOnboarding, type OnboardingState } from "./onboardingState";
import { OnboardingFlow } from "./OnboardingFlow";
import { useOnboardingRefresh } from "./onboardingRefresh";

/**
 * Decides whether a signed-in account still needs first-run setup. State is
 * per account (see onboardingState), so a second account on a shared device
 * gets its own setup instead of inheriting the first account's.
 *
 * A completed/skipped onboarding state is NOT enough on its own. The server
 * DOES auto-create a Personal workspace on every signup path (apps/api
 * 9a3ba8a6, live since 2026-08-02), so a brand-new account arrives with one -
 * an earlier comment here claimed the opposite, and believing it is what left
 * the step indicator counting a workspace step the primary cohort never sees.
 * But accounts that predate that change can still have none: the OLD
 * onboarding flow marked its completion flag when the user tapped "Get
 * started" - BEFORE the blocking create-workspace step that used to follow it
 * - so an account that quit right after that tap migrates in as "completed"
 * with zero workspaces, and WorkspaceGate no longer has a create-form branch
 * to save it. Leaving or deleting a last workspace lands in the same place.
 * So an account with no workspaces always runs the flow, regardless of what
 * its onboarding state says - OnboardingFlow's own stage logic already skips
 * workspace creation when workspaces DO exist, so this composes correctly for
 * the ordinary case too.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const { data: workspaces, isLoading: workspacesLoading, isError: workspacesErrored, refetch } = useWorkspaces();
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [finished, setFinished] = useState(false);
  // See onboardingRefresh.ts: a resume action (the Backup tab's finish-setup row) clears
  // `skippedAt` for the SAME account, so this is the only thing that tells a
  // live-mounted gate to look again - `accountId` alone never changes for it.
  const refreshEpoch = useOnboardingRefresh((s) => s.epoch);

  useEffect(() => {
    // Reset on every account change (or forced refresh) so a live-mounted
    // gate never goes on rendering a STALE verdict during the async gap
    // while the current account's state is (re)loading.
    setOnboarding(null);
    setFinished(false);
    if (!accountId) return;
    let alive = true;
    void readOnboarding(accountId).then((s) => {
      if (alive) setOnboarding(s);
    });
    return () => { alive = false; };
  }, [accountId, refreshEpoch]);

  const onFinished = useCallback(() => setFinished(true), []);

  // Only block on the workspaces fetch while it's genuinely still IN FLIGHT.
  // queryClient sets retry: 2, so once retries are exhausted an ordinary
  // failure (expired token, a 500, first launch offline) settles the query
  // to isLoading: false with `data` still undefined - the same shape as
  // "still loading". Blocking on `!workspaces` alone can't tell the two
  // apart, and would leave every signed-in user on this blank view forever,
  // with no route anywhere - worse than the bug this gate exists to fix.
  if (!accountId || !onboarding || workspacesLoading) {
    // Not a bare blank view: this is the network-bound wait, and a stalled
    // fetch used to leave a first-time user on an empty screen with nothing to
    // read and nothing to press. See GateScreen.
    return <GateScreen testID="onboarding-gate-loading" onRetry={() => { void refetch(); }} />;
  }

  // An errored fetch is NOT confirmed "zero workspaces". For an account that
  // already answered onboarding - and so, in the overwhelming common case,
  // already has a workspace - reading a network blip as "create one" would
  // walk it into WorkspaceStep and risk a duplicate workspace once the
  // backend recovers, which is worse than just letting it through. A
  // never-answered account still runs the flow regardless of fetch success or
  // error - and OnboardingFlow reads an errored fetch exactly the same way
  // this line does (see its `knownEmpty`), so the two cannot send the user in
  // opposite directions. Only a settled, SUCCESSFUL empty fetch is evidence
  // of zero workspaces; on that evidence the flow shows the interactive
  // WorkspaceStep, not a blank screen, and its create-workspace failure path
  // surfaces an inline toast rather than looping.
  const needsWorkspace = !workspacesErrored && (workspaces?.length ?? 0) === 0;
  // A deliberate skip is an answer, not an omission - never re-ask, UNLESS
  // the account now has no workspace to actually use the app with.
  const answered = onboarding.completedAt !== null || onboarding.skippedAt !== null;

  if (finished || (answered && !needsWorkspace)) return <>{children}</>;
  // `key` forces a fresh OnboardingFlow instance on an account switch - its
  // own internal stage state must never carry over from a different
  // account's session.
  return <OnboardingFlow key={accountId} accountId={accountId} onFinished={onFinished} />;
}
