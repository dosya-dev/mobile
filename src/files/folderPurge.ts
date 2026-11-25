/**
 * Permanently deleting a trashed folder, one bounded pass at a time.
 *
 * The purge spends storage round trips per file, so the API stopped trying to
 * do the whole thing in one request: it works through the folder until its
 * budget runs out and answers 202 `{ complete: false, remaining, files_affected }`,
 * or 200 `{ complete: true, remaining: 0 }` when there is nothing left. The
 * call is idempotent and the folder rows deliberately survive an unfinished
 * pass - they are how the next call re-enumerates what remains - so finishing
 * the job is simply asking again.
 *
 * The client half is this loop. Without it the app took the first answer as
 * the whole job and told the user a folder was gone while most of it was
 * still there.
 *
 * Mobile-local rather than imported from apps/web (see files/purge.ts for the
 * same reasoning): mobile does not depend on the web app. Behaviour is matched
 * to apps/web/src/lib/folder-purge.ts, including its two deliberate rules -
 * a body with no `complete` field counts as finished, and a rejection
 * propagates rather than being retried.
 */

/** The body of a permanent-delete answer. Every field is optional: an older API answers `{ ok: true }`. */
import { t } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

export interface PurgeResponse {
  ok?: boolean;
  permanent?: boolean;
  complete?: boolean;
  remaining?: number;
  files_affected?: number;
}

export interface FolderPurgeOutcome {
  /** False when the call cap stopped us with work still to do. */
  complete: boolean;
  /** Files removed across every pass. */
  filesAffected: number;
  /** What the last pass said was left. */
  remaining: number;
  calls: number;
}

/**
 * How many passes one tap will make. A folder large enough never to finish
 * would otherwise loop forever, hammering the API from a screen nobody is
 * watching; at the cap the user is told it is still emptying and can ask
 * again, which resumes exactly where this left off.
 */
export const MAX_FOLDER_PURGE_CALLS = 50;

export async function purgeTrashedFolder(
  purgeOnce: () => Promise<PurgeResponse>,
  opts: { maxCalls?: number } = {},
): Promise<FolderPurgeOutcome> {
  const maxCalls = Math.max(1, opts.maxCalls ?? MAX_FOLDER_PURGE_CALLS);
  let filesAffected = 0;
  let remaining = 0;
  let calls = 0;

  // A failure is thrown, not retried: a 403 or a 404 would be just as refused
  // fifty times over, and the caller has a message to show for it.
  while (calls < maxCalls) {
    const body = await purgeOnce();
    calls += 1;
    filesAffected += body.files_affected ?? 0;
    remaining = body.remaining ?? 0;
    // Anything but an explicit `false` counts as finished, so the ordinary
    // move-to-trash answer (a bare `{ ok: true }`) is not looped against.
    if (body.complete !== false) return { complete: true, filesAffected, remaining, calls };
  }

  return { complete: false, filesAffected, remaining, calls };
}

/**
 * What to tell the user when the loop stops. An unfinished purge is never
 * called "Deleted" - that sentence is the whole defect this exists to remove -
 * and it says what to do next, because asking again is the entire recovery.
 */
export function describeFolderPurge(outcome: FolderPurgeOutcome): string {
  if (outcome.complete) {
    return outcome.filesAffected > 0
      ? t("common.status.deletedRemovedPluralOneFileOtherFilesRemoved", { removed: outcome.filesAffected })
      : t("common.status.deleted");
  }
  return t("common.description.stillEmptyingRemovedPluralOneFileOtherFilesRemovedSoFarAboutRemainingTo", {
    removed: outcome.filesAffected,
    remaining: localDigits(outcome.remaining),
  });
}
