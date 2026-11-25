/**
 * Sequencing for permanent deletion.
 *
 * There is no bulk-purge endpoint. POST /api/files/batch-delete is documented
 * as soft-delete only and its WHERE clause carries `AND is_deleted = 0`, so it
 * is a no-op on rows that are already in the trash. Emptying a 200-item trash
 * therefore means 200 individual DELETE /api/files/:id calls - the second call
 * on an already-trashed file is what purges it from D1 and R2.
 *
 * Mobile-local rather than in @dosya-dev/shared: mobile is decoupled from that
 * package (see src/lib/format.ts), and empty-trash is a mobile-only surface.
 */

import { t } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

export interface PurgeOutcome {
  id: string;
  ok: boolean;
  error?: string;
}

export interface PurgeReport {
  outcomes: PurgeOutcome[];
  succeeded: string[];
  failed: string[];
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Run `deleteOne` over every id with a bounded number in flight, collecting a
 * per-id outcome instead of rejecting on the first failure. A single locked or
 * already-gone file must not strand the rest of the queue.
 */
export async function purgeSequence(
  ids: string[],
  deleteOne: (id: string) => Promise<void>,
  opts: { concurrency?: number } = {},
): Promise<PurgeReport> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const outcomes: PurgeOutcome[] = new Array(ids.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= ids.length) return;
      const id = ids[index];
      try {
        await deleteOne(id);
        outcomes[index] = { id, ok: true };
      } catch (err) {
        outcomes[index] = {
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()),
  );

  const succeeded = outcomes.filter((o) => o.ok).map((o) => o.id);
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.id);
  return { outcomes, succeeded, failed };
}

/**
 * Honest one-line summary. Never says "Trash emptied" when something failed:
 * this removes objects from R2 and cannot be undone, so a toast that overstates
 * it is worse than no toast at all.
 */
export function describePurgeReport(report: PurgeReport): string {
  const ok = report.succeeded.length;
  const bad = report.failed.length;
  if (bad === 0) return t("trash.status.okPluralOneItemOtherItemsDeleted", { ok });
  if (ok === 0) return t("trash.error.nothingWasDeletedBadFailed", { bad: localDigits(bad) });
  return t("trash.error.okDeletedBadCouldNotBeDeleted", { ok: localDigits(ok), bad: localDigits(bad) });
}
