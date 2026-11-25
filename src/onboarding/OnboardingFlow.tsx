import { useEffect, useState } from "react";
import { useWorkspaces } from "@/files/hooks";
import { GateScreen } from "@/ui/GateScreen";
import { useT } from "@/lib/i18n";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { writeOnboarding } from "./onboardingState";
import { StepProgressProvider } from "./ui/StepScreen";
import { WorkspaceStep } from "./steps/WorkspaceStep";
import { PhotoAccessStep } from "./steps/PhotoAccessStep";
import { PermissionDeniedStep } from "./steps/PermissionDeniedStep";
import { ChooseStep } from "./steps/ChooseStep";
import { FirstBackupStep } from "./steps/FirstBackupStep";

type Stage = "workspace" | "photos" | "denied" | "choose" | "running";

const now = () => Math.floor(Date.now() / 1000);

/**
 * The setup sequence. Each step owns its own content and reports upward;
 * this component owns only the order and what gets persisted at each exit.
 */
export function OnboardingFlow({
  accountId, onFinished,
}: {
  accountId: string;
  onFinished: () => void;
}) {
  const t = useT();
  const { data: workspaces, isLoading, isError, refetch } = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId);
  // Carried from step 2 into step 3, which must say so when the counts cover
  // only the assets the user hand-picked.
  const [limited, setLimited] = useState(false);
  // `null` = not decided yet. A re-install or a second device already has a
  // workspace, and asking such an account to create another one would be a
  // bug, not onboarding - so the starting stage is decided from the workspace
  // list, not assumed empty while that list is still loading.
  const [stage, setStage] = useState<Stage | null>(null);
  // Whether THIS run includes the workspace step, so the progress indicator
  // counts the steps actually being shown rather than a fixed four.
  const [withWorkspaceStep, setWithWorkspaceStep] = useState(false);

  // Only a settled, SUCCESSFUL fetch is evidence that an account has no
  // workspace. OnboardingGate reads an errored fetch exactly the same way
  // (see its `needsWorkspace`); the two used to read it in OPPOSITE
  // directions, which pinned a reinstall on a flaky network to "Name your
  // first workspace" permanently - and its only forward action creates a
  // DUPLICATE workspace, making the user's real files look missing.
  const knownEmpty = !isLoading && !isError && (workspaces?.length ?? 0) === 0;
  const knownHasOne = !isLoading && (workspaces?.length ?? 0) > 0;

  useEffect(() => {
    // Once the user is past the workspace question the stage is theirs; the
    // fetch never moves them again.
    if (stage !== null && stage !== "workspace") return;
    if (isLoading) return;

    // The step COUNT is decided once - here, when the flow first picks its
    // starting stage - and never revised mid-run. WorkspaceStep awaits
    // invalidateQueries(["workspaces"]), which resolves only once the refetch
    // has landed in the cache, so this effect observes the new list while the
    // user is STILL on the workspace step, falls through below, and would
    // otherwise renumber a "Step 1 of 4" run to "Step 1 of 3" under them
    // mid-press - with the bar not advancing.
    const decidingStartStage = stage === null;

    if (knownEmpty) {
      if (decidingStartStage) {
        setStage("workspace");
        setWithWorkspaceStep(true);
      }
      return;
    }

    // Sitting on the workspace step with the list still unknown (errored):
    // leave the interactive screen alone rather than yanking the user off a
    // form they may be typing into. A later successful fetch falls through
    // below and CORRECTS the stage - the decision is never latched.
    if (stage === "workspace" && !knownHasOne) return;

    // The skip-workspace-step cohort (every new signup, since the server
    // auto-creates a Personal workspace, plus reinstalls and second devices)
    // never runs WorkspaceStep.onCreate - the only other place that calls
    // setActive is WorkspaceGate, which lives inside OnboardingGate in
    // app/_layout.tsx and therefore only runs AFTER onboarding finishes.
    // Without adopting one here, activeId stays null all the way through
    // photos -> choose -> running: ChooseStep's storage-overflow check goes
    // silently disabled (useWorkspaceStorage(null) is disabled) and
    // FirstBackupStep would call runBackup for workspace "" - the backup this
    // whole flow exists to start would never start.
    const first = workspaces?.[0] ?? null;
    const alreadyActive = activeId != null && (workspaces?.some((w) => w.id === activeId) ?? false);
    void (async () => {
      if (first && !alreadyActive) {
        try {
          await useWorkspaceStore.getState().setActive(first.id);
        } catch {
          // setActive persists to SecureStore. A rejection here used to skip
          // setStage entirely, leaving `stage` null forever with deps that
          // never change again - the whole app blank, permanently, for
          // exactly the cohort this branch exists to serve. The in-memory
          // selection is already set by the store before it persists, so
          // losing the write costs the choice surviving a restart, nothing
          // more; WorkspaceGate re-picks the same first workspace anyway.
        }
      }
      setStage("photos");
      // `withWorkspaceStep` is deliberately NOT touched here. It starts false,
      // so the ordinary skip cohort is already correct, and revising it on the
      // correction path would renumber a run the user is partway through - see
      // `decidingStartStage` above. A user who was shown the workspace step
      // keeps counting it, even if a late fetch is what moved them off it.
    })();
  }, [stage, isLoading, isError, knownEmpty, knownHasOne, workspaces, activeId]);

  const workspaceName =
    workspaces?.find((w) => w.id === activeId)?.name ?? workspaces?.[0]?.name ?? t("onboarding.label.yourWorkspace");

  // writeOnboarding serializes internally per account and never rejects (see
  // onboardingState's error contract), so an un-awaited call here
  // (photoPermission below) neither races a later awaited one nor leaves an
  // unhandled rejection, and `onFinished` cannot be skipped by a storage
  // failure. This component only ever writes onboarding state, it never reads
  // it back, so nothing here depends on a write having already landed.
  const finish = async (patch: Parameters<typeof writeOnboarding>[1]) => {
    await writeOnboarding(accountId, patch);
    onFinished();
  };

  const step = (): React.ReactNode => {
    if (stage === "workspace") return <WorkspaceStep onDone={() => setStage("photos")} />;

    if (stage === "photos") {
      return (
        <PhotoAccessStep
          workspaceName={workspaceName}
          onGranted={(p) => {
            void writeOnboarding(accountId, { photoPermission: p });
            setLimited(p === "limited");
            setStage("choose");
          }}
          onDenied={() => {
            void writeOnboarding(accountId, { photoPermission: "denied" });
            setStage("denied");
          }}
        />
      );
    }

    if (stage === "denied") {
      return <PermissionDeniedStep onContinue={() => { void finish({ skippedAt: now(), completedAt: null }); }} />;
    }

    if (stage === "choose") {
      return (
        <ChooseStep
          workspaceId={activeId}
          limited={limited}
          onDone={() => setStage("running")}
          onSkip={() => { void finish({ skippedAt: now(), completedAt: null }); }}
        />
      );
    }

    return (
      <FirstBackupStep
        workspaceId={activeId ?? ""}
        workspaceName={workspaceName}
        onDone={() => { void finish({ completedAt: now(), skippedAt: null }); }}
      />
    );
  };

  // Only while the workspace list is still in flight - see the effect above,
  // which always settles on a stage once it is not. "In flight" is not bounded
  // by anything the app controls, though: the API client sets no timeout and
  // queryClient retries twice, so this can hold for minutes on a half-open
  // connection. It says so rather than showing an empty screen.
  if (stage === null) return <GateScreen testID="onboarding-loading" onRetry={() => { void refetch(); }} />;

  return (
    <StepProgressProvider total={withWorkspaceStep ? 4 : 3} offset={withWorkspaceStep ? 0 : 1}>
      {step()}
    </StepProgressProvider>
  );
}
