import type { T } from "@/i18n/translator";
import { moveFile as apiMoveFile, moveFolder as apiMoveFolder } from "./mutations";
import { mostCommon, type MoveItems } from "./dragMove";

/**
 * Run a per-item async task across a selection with bounded concurrency.
 *
 * Ported from apps/web/src/lib/bulk-run.ts. One request per item in a `for`
 * loop makes a 50-item move 50 round trips end to end; unbounded Promise.all
 * opens one socket per item and trips rate limiting. This keeps a fixed
 * number in flight. A rejected task is counted, never thrown.
 */
export interface BulkResult<R> {
  ok: number;
  fail: number;
  /** Per-input results in input order; `null` where the task rejected. */
  results: (R | null)[];
}

export const BULK_CONCURRENCY = 4;

export async function runBulk<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  limit: number = BULK_CONCURRENCY,
): Promise<BulkResult<R>> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let ok = 0;
  let fail = 0;
  if (items.length === 0) return { ok, fail, results };
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await task(items[i], i);
        ok++;
      } catch {
        fail++;
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return { ok, fail, results };
}

export interface MoveOutcome {
  ok: number;
  fail: number;
  /** What the server said for each refused item, so the toast can say why. */
  reasons: string[];
}

export interface MoveDeps {
  moveFile: (id: string, folderId: string | null) => Promise<unknown>;
  moveFolder: (id: string, parentId: string | null) => Promise<unknown>;
}

const liveDeps: MoveDeps = { moveFile: apiMoveFile, moveFolder: apiMoveFolder };

/**
 * The Live Photo videos a selection carries along: the twin of every selected
 * still that is not itself selected. The grid collapses a twin under its
 * still, so the twin's own row is usually not in the selection. Computed where
 * the listing is (the browser) and handed to moveItems as `twinIds`, because
 * the destination picker has no listing to look them up in.
 */
export function liveTwinIds(files: readonly { id: string; live_video_id?: string | null }[], selected: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const f of files) {
    const twin = f.live_video_id;
    if (!twin || !selected.has(f.id) || selected.has(twin) || out.includes(twin)) continue;
    out.push(twin);
  }
  return out;
}

/**
 * Move files and folders to `destFolderId` (null = workspace root), the way
 * the web page's bulk move does: one PUT per item, twins carried along but
 * kept out of the counts, every refusal recorded with its message.
 */
export async function moveItems(
  items: MoveItems,
  destFolderId: string | null,
  twinIds: readonly string[],
  deps: MoveDeps = liveDeps,
): Promise<MoveOutcome> {
  const reasons: string[] = [];
  const noting = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A) => {
    try {
      await fn(...a);
    } catch (e) {
      if (e instanceof Error && e.message) reasons.push(e.message);
      throw e;
    }
  };
  const fileRes = await runBulk(items.fileIds, (id) => noting(deps.moveFile)(id, destFolderId));
  await runBulk(twinIds, (id) => deps.moveFile(id, destFolderId));
  const folderRes = await runBulk(items.folderIds, (id) => noting(deps.moveFolder)(id, destFolderId));
  return { ok: fileRes.ok + folderRes.ok, fail: fileRes.fail + folderRes.fail, reasons };
}

/** The one-line toast for a finished move, with web's wording. */
export function describeMoveOutcome(outcome: MoveOutcome, t: T): { message: string; kind: "success" | "error" } {
  const { ok, fail } = outcome;
  if (fail === 0) return { message: t("files.feedback.okPluralOneItemOtherItemsMoved", { ok }), kind: "success" };
  const reason = mostCommon(outcome.reasons) ?? t("files.error.theFileCouldNotBeMoved");
  if (ok === 0 && fail === 1) return { message: reason, kind: "error" };
  return { message: t("files.error.okMovedFailNotMovedReason", { ok, fail, reason }), kind: "error" };
}
