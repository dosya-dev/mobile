import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { byteCount } from "@/lib/format-locale";
import { useBackupSettings } from "@/backup/settings";
import { runBackup, clearManualStop } from "@/backup/orchestrator";
import { useBackupRun } from "@/backup/runState";
import { useUploadStore } from "@/upload/store";
import { computeUploadStats } from "@/upload/stats";
import { StepScreen } from "../ui/StepScreen";
import { BackupPreviewGrid } from "../ui/BackupPreviewGrid";

/**
 * Setup ends on the product working, not on a button.
 *
 * The old flow left autoBackup false and dropped a new account on an empty
 * Files tab, so the app's main feature was off and nothing in first run ever
 * turned it on. This step turns it on and starts the first run.
 */
export function FirstBackupStep({
  workspaceId, workspaceName, onDone,
}: {
  workspaceId: string;
  workspaceName: string;
  onDone: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const items = useUploadStore((s) => s.items);
  // Done backup uploads are FOLDED OUT of `items` mid-run (see
  // useUploadStore.foldSettledBk, called in the finally of every successful
  // upload so RAM stays flat on a 5k-photo run). Their counts live here.
  const settledBk = useUploadStore((s) => s.settledBk);
  const phase = useBackupRun((s) => s.phase);
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  // The awaited run has settled (either way). Distinguishes "nothing has been
  // enqueued YET" from "the run finished and there was nothing to enqueue" -
  // an empty live array alone cannot tell those apart, and guessing wrong
  // tells a user their library is empty seconds after counting it.
  const [runFinished, setRunFinished] = useState(false);
  // Only true once the settings write actually landed, so the card never
  // claims auto-backup is on because we intended it to be.
  const [autoBackupOn, setAutoBackupOn] = useState(false);
  // OnboardingFlow adopts an existing workspace as active before this step can
  // ever mount, so this should be unreachable in practice - but the prop is
  // typed `string`, not `string | null`, so a defensive caller could still
  // hand this an empty string, and runBackup("") must never be the result of
  // silently trusting that.
  const noWorkspace = !workspaceId;

  useEffect(() => {
    // StrictMode's double-invoke, and any re-render, must not launch a second
    // concurrent run - a ref guard is checked and set synchronously, so it is
    // live before the effect body below ever reaches runBackup.
    if (started.current) return;
    started.current = true;
    if (!workspaceId) return; // nothing to back up to - see the noWorkspace render below
    void (async () => {
      // The settings write is INSIDE the try. It used to sit outside it, so a
      // storage failure there skipped runBackup entirely and left this screen
      // claiming "Auto-backup is on" over a run that never started.
      try {
        await useBackupSettings.getState().update({ autoBackup: true });
        setAutoBackupOn(true);
        // Resets the session-scoped latch a manual Stop leaves behind. Only the
        // AUTO-triggered path (background task / media-change listener) ever
        // consults this latch - runBackup itself does not - so this clears it
        // for whichever auto run comes after this one, not for the manual call
        // immediately below, which would run either way.
        clearManualStop();
        await runBackup(workspaceId, workspaceName, {});
      } catch {
        // A failed run must not trap the user on this screen - Done still
        // works, and the Backup tab is always there to retry.
        setFailed(true);
      } finally {
        setRunFinished(true);
      }
    })();
  }, [workspaceId, workspaceName]);

  // Backup items only, WITH the settled baseline folded back in - the same
  // shape UploadDock, app/(tabs)/backup.tsx and statusBridge all use. Counting
  // the raw live array instead (no `settled`, no bk_ filter) made doneCount
  // ~always 0 and the total count DOWN as uploads succeeded, because
  // foldSettledBk removes each finished item from `items`.
  //
  // No batch clock is threaded through here - this step only needs a
  // done/total count, not speed or ETA. `now` is read inside computeUploadStats
  // only when startedAt is non-null, so a literal keeps this call pure instead
  // of reading the clock during render for a value that would go unused.
  const bk = items.filter((i) => i.id.startsWith("bk_"));
  const stats = computeUploadStats(bk, null, 0, settledBk);
  // "Genuinely nothing to back up" is a property of the FINISHED run and an
  // IDLE engine, never of an empty live array: that array is empty before the
  // run starts and empty again after every item has settled out of it.
  const empty =
    runFinished && phase === "idle" && !failed && !noWorkspace && stats.totalCount === 0;
  const showProgress = !failed && !noWorkspace && !empty && stats.totalCount > 0;
  const pct = stats.totalCount > 0 ? Math.round((stats.doneCount / stats.totalCount) * 100) : 0;

  const title = noWorkspace
    ? t("onboarding.heading.noWorkspaceToBackUpTo")
    : failed
      ? t("onboarding.error.backupCouldNotStart")
      : empty
        ? t("onboarding.heading.nothingToBackUpYet")
        : t("onboarding.heading.backingUpNow");
  const subtitle = noWorkspace
    ? t("onboarding.description.createOrChooseAWorkspaceFromTheFilesTabThenStartYourBackupFrom")
    : failed
      ? t("onboarding.description.youCanStartItAgainAnyTimeFromTheBackupTab")
      : empty
        ? t("onboarding.description.yourLibraryIsEmptyRightNowNewPhotosWillUploadOnTheirOwnAs")
        : t("onboarding.description.youCanCloseTheAppItKeepsGoingInTheBackground");

  // What the card is allowed to SAY about auto-backup, derived from what
  // actually happened rather than from what this step set out to do.
  const autoState: "unavailable" | "failed" | "on" | "pending" = noWorkspace
    ? "unavailable"
    : autoBackupOn
      ? "on"
      : failed
        ? "failed"
        : "pending";
  const autoCopy = {
    unavailable: [t("onboarding.label.autoBackupIsOffForNow"), t("onboarding.description.itTurnsOnTheMomentAWorkspaceIsReady")],
    failed: [t("onboarding.error.autoBackupCouldNotBeTurnedOn"), t("onboarding.description.youCanTurnItOnAnyTimeFromTheBackupTab")],
    on: [t("onboarding.label.autoBackupIsOn"), t("onboarding.description.newPhotosUploadOnTheirOwnFromNowOn")],
    pending: [t("onboarding.label.turningOnAutoBackup"), t("onboarding.description.oneMoment")],
  }[autoState];
  const autoOk = autoState === "on" || autoState === "pending";

  return (
    <StepScreen
      step={4}
      testID="onboarding-first-backup"
      title={title}
      subtitle={subtitle}
      primaryLabel={t("common.done")}
      onPrimary={onDone}
    >
      <View testID="auto-backup-card" className="rounded-2xl border border-border bg-card p-4">
        <View className="flex-row items-center gap-3">
          <View
            className={`h-10 w-10 items-center justify-center rounded-xl ${autoOk ? "bg-primary/15" : "bg-secondary"}`}
          >
            <Icon
              name={autoOk ? "cloud-upload" : "alert-circle"}
              size={19}
              color={autoOk ? tokens.primary : tokens.mutedForeground}
            />
          </View>
          <View className="flex-1">
            <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>
              {autoCopy[0]}
            </Text>
            <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {autoCopy[1]}
            </Text>
          </View>
        </View>
        {showProgress ? (
          <>
            <View className="mt-4 flex-row items-baseline justify-between">
              <Text
                testID="first-backup-progress"
                accessibilityLiveRegion="polite"
                accessibilityLabel={t("onboarding.label.backingUpDoneOfTotal", { done: byteCount(stats.doneCount), total: byteCount(stats.totalCount) })}
                className="text-xs text-muted-foreground"
                style={{ fontFamily: fonts.mono }}
              >
                {t("common.label.sentOfTotal", { sent: byteCount(stats.doneCount), total: byteCount(stats.totalCount) })}
              </Text>
              <Text className="text-xs text-primary" style={{ fontFamily: fonts.mono }}>
                {pct}%
              </Text>
            </View>
            <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-input">
              <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </View>
            <BackupPreviewGrid doneCount={stats.doneCount} />
          </>
        ) : null}
      </View>
    </StepScreen>
  );
}
