import { byteCount } from "@/lib/format-locale";
import { t } from "@/lib/i18n";
import type { NetworkKind } from "./network";

export type AttentionId =
  | "finish-setup"
  | "photo-access"
  | "limited-access"
  | "nothing-selected"
  | "choose-what"
  | "excluded"
  | "blocked"
  | "offline"
  | "waiting-for-wifi"
  | "cellular-data";

export interface AttentionItem {
  id: AttentionId;
  title: string;
  detail: string;
  /** warn: backup is not doing what the user expects. info: a condition worth knowing. */
  tone: "warn" | "info";
  /** Whether tapping the row does something (the screen maps the id to the action). */
  actionable: boolean;
}

export interface AttentionInput {
  /** Onboarding was skipped: "denied" when photo access is the reason, "other" otherwise. */
  unfinishedSetup: "denied" | "other" | null;
  /** Photo library permission; null until the first read resolves. */
  photoAccess: boolean | null;
  /** iOS limited-library access. */
  limited: boolean;
  filtersMigrated: boolean;
  /** Folder filter set to "include" with no folders. */
  nothingSelected: boolean;
  /** The filters leave part of the phone out (see coverageWarning): the row's words. */
  excluded: { title: string; detail: string } | null;
  /** Auto-backup stopped by the engine (storage limit, etc.). */
  blockReason: string | null;
  network: NetworkKind;
  runActive: boolean;
}

/**
 * Everything the old page said with seven separate cards, as one ordered list.
 * Worst first: a backup that cannot run at all outranks one that is merely
 * waiting. Anything the ring already states (a mid-run Wi-Fi hold) is left
 * out so no fact is printed twice.
 */
export function deriveAttention(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (i.unfinishedSetup) {
    out.push({
      id: "finish-setup",
      title: t("backup.heading.finishSettingUpBackup"),
      detail:
        i.unfinishedSetup === "denied"
          ? t("backup.description.photoAccessIsStillOffSoNothingIsBeingBackedUpYet")
          : t("backup.description.youHaveNotChosenWhatToBackUpYetSoNothingIsRunning"),
      tone: "warn",
      actionable: true,
    });
  }
  // `null` means still checking: never flash this at a user who already granted it.
  if (i.photoAccess === false) {
    out.push({
      id: "photo-access",
      title: t("backup.heading.allowPhotoAccess"),
      detail: t("backup.description.neededToCopyNewPhotosAndVideosIntoYourWorkspaceFullResolutionOriginalsIn"),
      tone: "warn",
      actionable: true,
    });
  }
  if (i.limited) {
    out.push({
      id: "limited-access",
      title: t("backup.heading.limitedPhotoAccess"),
      detail: t("backup.description.onlySelectedPhotosBackUpTapToAllowFullAccessInSettings"),
      tone: "warn",
      actionable: true,
    });
  }
  if (i.nothingSelected) {
    out.push({
      id: "nothing-selected",
      title: t("backup.heading.noFoldersSelected"),
      detail: t("backup.description.nothingIsBeingBackedUpChooseAtLeastOneFolder"),
      tone: "warn",
      actionable: true,
    });
  }
  if (!i.filtersMigrated) {
    out.push({
      id: "choose-what",
      title: t("backup.heading.chooseWhatToBackUp"),
      detail: t("backup.description.rightNowThisCoversEveryPhotoAndVideoOnYourDeviceIncludingMediaSaved"),
      tone: "info",
      actionable: true,
    });
  }
  // Not a fault, but the single most misread fact on the page: a total that
  // is smaller than the phone looks like lost photos until this says why.
  if (i.excluded) {
    out.push({ id: "excluded", title: i.excluded.title, detail: i.excluded.detail, tone: "warn", actionable: true });
  }
  if (i.blockReason) {
    const reason = i.blockReason.trim().replace(/[.!?]+$/, "");
    out.push({
      id: "blocked",
      title: t("backup.heading.autoBackupPaused"),
      detail: t("backup.description.reasonTapToRetry", { reason }),
      tone: "warn",
      // Until the last in-flight upload settles the engine press means STOP,
      // so the row waits for the run to actually drain before offering retry.
      actionable: !i.runActive,
    });
  }
  // Mid-run, the ring's status already reads "Paused - offline" / "Paused -
  // waiting for Wi-Fi" (see backupHoldReason), so neither is repeated here.
  if (i.network === "offline" && !i.runActive) {
    out.push({
      id: "offline",
      title: t("backup.heading.youReOffline"),
      detail: t("backup.description.backupResumesWhenAConnectionReturns"),
      tone: "info",
      actionable: false,
    });
  } else if (i.network === "waiting-for-wifi" && !i.runActive) {
    out.push({
      id: "waiting-for-wifi",
      title: t("backup.heading.waitingForWiFi"),
      detail: t("backup.description.automaticBackupPausesOnMobileDataChangeInBackupSettings"),
      tone: "info",
      actionable: true,
    });
  } else if (i.network === "cellular-data") {
    out.push({
      id: "cellular-data",
      title: t("backup.heading.wiFiIsOff"),
      detail: t("backup.description.backingUpNowWillUseMobileData"),
      tone: "warn",
      actionable: false,
    });
  }
  return out;
}

/** A counted heading for the list; a single row needs none. */
export function attentionHeading(count: number, firstRun: boolean): string | null {
  if (count < 2) return null;
  return firstRun
    ? t("backup.label.countThingsBeforeTheFirstBackup", { count: byteCount(count) })
    : t("backup.label.countThingsNeedAttention", { count: byteCount(count) });
}
