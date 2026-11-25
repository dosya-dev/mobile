// The words the native side shows for Personas background reading: the
// Android notification (title, count, Pause action, channel name), the
// WorkManager "tap to keep reading" notification and the iOS continued
// task's system UI. Translated with t() in the language current when called,
// so call it only when the strings are needed (never at module load); the
// headless start boots the language first (personasHeadlessTask).
import { t } from "@/lib/i18n";

export interface PersonasBackgroundStrings {
  /** Android notification title. */
  title: string;
  /** Android notification text: the count, "" while it is not known. */
  text: string;
  /** Android notification action that pauses Personas on this phone. */
  pauseLabel: string;
  /** Android notification channel name in the phone's settings. */
  channelName: string;
  /** Android: shown when the worker cannot start reading without the app. */
  tapText: string;
  /** iOS continued task title. */
  continuedTitle: string;
  /** iOS continued task subtitle: the count, "" while it is not known. */
  continuedSubtitle: string;
}

export function personasBackgroundStrings(progress?: { read: number; total: number }): PersonasBackgroundStrings {
  const count = progress && progress.total > 0
    ? t("personas.label.readOfTotal", { read: Math.max(0, Math.floor(progress.read)), total: Math.max(0, Math.floor(progress.total)) })
    : "";
  const title = t("personas.label.readingPhotosForPersonas");
  return {
    title,
    text: count,
    pauseLabel: t("personas.action.pause"),
    channelName: t("common.label.personas"),
    tapText: t("personas.description.tapToKeepReadingPhotosForPersonas"),
    continuedTitle: title,
    continuedSubtitle: count,
  };
}
