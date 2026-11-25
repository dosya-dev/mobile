import { getItem, setItem, deleteItem } from "@/lib/keychain";

/**
 * Per-workspace scan watermarks - the heart of incremental scanning.
 *
 * `newestCreatedAt` is the newest asset creationTime a COMPLETED scan has seen:
 * auto runs only scan assets created after it (minus an overlap margin), so the
 * hourly background run touches ~zero assets instead of sweeping the whole
 * library. `lastFullScanAt` schedules the periodic full reconcile that heals
 * what the filter can miss (e.g. AirDrop imports carrying old creation dates).
 *
 * Stored as one JSON map so sign-out can purge every workspace's entry with a
 * single key delete (SecureStore cannot enumerate keys).
 */
const KEY = "dosya.backup.watermarks";

/** Re-scan this far behind the watermark; ledger dedup makes the overlap free. */
export const WATERMARK_OVERLAP_S = 60 * 60;
/** Run a full reconcile when the last one is older than this. */
export const FULL_RECONCILE_AFTER_S = 24 * 60 * 60;

export interface WorkspaceWatermark {
  newestCreatedAt: number; // unix seconds
  lastFullScanAt: number; // unix seconds
}

type WatermarkMap = Record<string, WorkspaceWatermark>;

async function readAll(): Promise<WatermarkMap> {
  try {
    const raw = await getItem(KEY);
    return raw ? (JSON.parse(raw) as WatermarkMap) : {};
  } catch {
    return {};
  }
}

export async function getWatermark(workspaceId: string): Promise<WorkspaceWatermark | null> {
  return (await readAll())[workspaceId] ?? null;
}

/**
 * Advance after a scan COMPLETED (not canceled, not blocked). Watermarks only
 * move forward; `fullScan` also stamps the reconcile clock.
 */
export async function advanceWatermark(
  workspaceId: string,
  newestCreatedAt: number,
  opts: { fullScan: boolean; now?: number },
): Promise<void> {
  try {
    const all = await readAll();
    const prev = all[workspaceId];
    all[workspaceId] = {
      newestCreatedAt: Math.max(prev?.newestCreatedAt ?? 0, newestCreatedAt),
      lastFullScanAt: opts.fullScan ? (opts.now ?? Math.floor(Date.now() / 1000)) : (prev?.lastFullScanAt ?? 0),
    };
    await setItem(KEY, JSON.stringify(all));
  } catch {
    /* best-effort - worst case the next auto run scans more than it needed to */
  }
}

/** Account purge (sign-out). */
export async function clearWatermarks(): Promise<void> {
  await deleteItem(KEY);
}
