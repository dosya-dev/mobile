import type { AssetStatus } from "./ledger";

export interface Coverage {
  /** Library items backed up, capped at the library size. */
  uploaded: number;
  /** Library items still to back up. */
  pending: number;
  /** Eligible library items under the current filters; null when the library
   * could not be counted (no photo permission). */
  total: number | null;
}

/**
 * The dashboard's numbers, derived from the library rather than from the
 * ledger alone.
 *
 * The ledger only holds rows for assets the scan has reached, and the scan is
 * throttled on purpose (it parks at MAX_LIVE_QUEUE live uploads so a huge
 * library never sits in memory). Its `pending` count is therefore "what is in
 * flight right now", never "what is left": a 7,000-photo library reads as
 * about 200 pending for the whole first run. Counting down from the filtered
 * library total gives the number the user actually asked for.
 *
 * Without a library total (permission not granted) the ledger counts are the
 * best available and are passed through unchanged.
 */
export function deriveCoverage(counts: Record<AssetStatus, number>, libraryTotal: number | null): Coverage {
  // `queued` has a job in flight, not a completed upload - it counts as
  // pending in both branches below.
  if (libraryTotal == null) return { uploaded: counts.uploaded, pending: counts.pending + counts.queued, total: null };
  // An item deleted from the device after backup keeps its uploaded row, so the
  // ledger can exceed the library; never show "7,100 of 7,000".
  const uploaded = Math.min(counts.uploaded, libraryTotal);
  // Items that will never upload (over the size limit, or past the retry cap)
  // are settled, not pending, or the backup reads as permanently unfinished.
  // `queued` is already excluded implicitly: it is not uploaded, skipped, or
  // errored, so it stays inside this count-down.
  const pending = Math.max(0, libraryTotal - counts.uploaded - counts.skipped_large - counts.error);
  return { uploaded, pending, total: libraryTotal };
}
