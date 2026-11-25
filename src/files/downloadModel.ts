import { formatBytes, formatDuration, formatSpeed } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Everything the download UI decides, in one pure module.
 *
 * The screen this replaces carried a single `saving` boolean, so the 46px
 * action circle looked identical at second 1 and second 170 of a half-gigabyte
 * transfer. That is what users were reporting as "nothing happens when I press
 * download". Deciding here means the ring, the progress line, the list row and
 * the notification all read the same numbers, and none of them needs a
 * component mounted to be tested.
 */

/**
 * Phases, in the order they happen.
 *
 * `saving` is separate from `downloading` because it genuinely is: on Android
 * the write through the Storage Access Framework happens after the last byte
 * lands and reports no progress at all, and above 64MB the bytes are handed to
 * the share sheet instead. Folding it into `downloading` would leave the ring
 * parked at 99 looking stuck for the length of a real, working operation.
 */
export type DownloadPhase = "preparing" | "downloading" | "saving" | "done" | "error";

export interface DownloadEntry {
  fileId: string;
  name: string;
  phase: DownloadPhase;
  /** Bytes on disk so far. */
  written: number;
  /** Bytes expected. 0 until the response headers land - see ringState. */
  total: number;
  /** ms epoch, for the cumulative-average rate. */
  startedAt: number;
  message?: string;
  /**
   * Where the transfer was started. Captured at start rather than looked up
   * later, because the point is to survive the user switching workspace - and
   * after a switch the listing that knew this file's workspace is gone.
   */
  workspaceId?: string;
  /**
   * The name as it read when the transfer began. Stored alongside the id
   * rather than resolved on demand: workspace names come from a query whose
   * cache can be evicted or refetched, and a transfer must not lose its label
   * because an unrelated request was invalidated.
   */
  workspaceName?: string;
}

// `foreignWorkspace` lived here: it decided when a transfer should name its
// workspace, which was only once the person had browsed somewhere else. Its
// one caller was DownloadDock, and that is gone. The orbit sheet, which
// replaced the dock, does not label workspaces at all - so the rule is not
// implemented anywhere right now rather than implemented twice.

/**
 * The size at which the viewer sheet grows a progress line under the facts.
 *
 * Below this a download is over in a second or two on any usable connection,
 * and a bar would appear and vanish faster than it could be read. The ring
 * still reports on every size, so nothing is unreported - only unelaborated.
 */
export const SHOW_LINE_BYTES = 25 * 1024 * 1024;

/** Progress step worth a store write. Matches `upload/controller.ts`. */
export const PROGRESS_STEP = 0.02;

/**
 * Emit on time as well as on step, because a 2%-only rule freezes the ring for
 * minutes on a slow connection - which is the complaint this work started from.
 */
const PROGRESS_MS = 250;

/** How long `Saved` holds before the row goes back to a plain Download. */
export const DONE_HOLD_MS = 1600;

/**
 * Whether a native progress callback is worth putting in the store.
 *
 * The native downloader fires far more often than a 46px ring can show, and
 * every emitted tick is a Zustand write plus a re-render of the viewer, the
 * list row and the dock.
 */
export function shouldEmitProgress(
  last: { pct: number; at: number } | null,
  pct: number,
  now: number,
): boolean {
  // First tick always lands, so pressing Download shows something at once.
  if (!last) return true;
  // The last tick always lands, or the ring stops one step short of full.
  if (pct >= 1) return true;
  // Compared in whole percentage points, not as floats: a caller stepping in
  // exact 2% increments hits `0.42 - 0.40 === 0.019999999999999962`, and a
  // naive `>= 0.02` suppresses every single one of them. Whole points are also
  // what the ring actually draws.
  const step = Math.round(pct * 100) - Math.round(last.pct * 100);
  if (step >= PROGRESS_STEP * 100) return true;
  return now - last.at >= PROGRESS_MS;
}

export interface DownloadStats {
  pct: number;
  bytesPerSec: number;
  etaSec: number | null;
}

/**
 * Rate is a cumulative average over the whole transfer, matching
 * `computeUploadStats` rather than an EMA. A smoothed rate looks better and
 * lies about the estimate right when the estimate matters - at the start.
 */
export function downloadStats(entry: DownloadEntry, now: number): DownloadStats {
  const total = entry.total > 0 ? entry.total : 0;
  const written = Math.max(0, entry.written);
  // A server that over-reports Content-Length must not produce 104%.
  const pct = total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;

  const elapsedSec = Math.max(0, (now - entry.startedAt) / 1000);
  const bytesPerSec = elapsedSec > 0 ? written / elapsedSec : 0;

  const remaining = total > 0 ? Math.max(0, total - written) : 0;
  const etaSec = bytesPerSec > 0 && remaining > 0 ? remaining / bytesPerSec : null;

  return { pct, bytesPerSec, etaSec };
}

/** The mono line under the bar: what has landed, how fast, and how much longer. */
export function progressCaption(entry: DownloadEntry, now: number): string {
  if (entry.phase === "saving") return t("common.label.savingToYourPhoneInFiles");
  if (entry.phase === "done") return t("common.label.savedTotalSize", { totalSize: formatBytes(entry.total || entry.written) });
  if (entry.phase === "error") {
    // Naming the byte count is the point: a resumable download picks up from
    // there, so the number is the reassurance, not decoration.
    return t("common.label.stoppedAtSizeTapToResume", { size: formatBytes(entry.written) });
  }

  const { bytesPerSec, etaSec } = downloadStats(entry, now);
  // The total is deliberately absent: the meta line directly above already
  // says how big the file is, and repeating it pushed the estimate off the end.
  return t("common.status.writtenHasSpeedSelectTrueSpeedOtherHasEtaSelectTrueEtaLeftOther", {
    written: formatBytes(entry.written),
    hasSpeed: String(bytesPerSec > 0),
    speed: bytesPerSec > 0 ? formatSpeed(bytesPerSec) : "",
    hasEta: String(etaSec != null),
    eta: etaSec != null ? formatDuration(etaSec) : "",
  });
}

export type RingState = "idle" | "preparing" | "downloading" | "saving" | "done" | "error";

/**
 * What the ring draws.
 *
 * `downloading` with no total yet is still `preparing`: an arc drawn against an
 * unknown total would be a number the app invented. It sweeps instead, which is
 * the honest shape for "working, length unknown".
 */
export function ringState(entry: DownloadEntry | undefined): RingState {
  if (!entry) return "idle";
  if (entry.phase === "preparing") return "preparing";
  if (entry.phase === "downloading") return entry.total > 0 ? "downloading" : "preparing";
  return entry.phase;
}

/** The label under the ring in the action row. */
export function ringLabel(state: RingState): string {
  switch (state) {
    case "idle": return t("common.action.download");
    case "preparing": return t("common.status.preparing");
    case "downloading": return t("common.status.downloading");
    case "saving": return t("common.status.saving");
    case "done": return t("common.status.saved");
    case "error": return t("common.retry");
  }
}
