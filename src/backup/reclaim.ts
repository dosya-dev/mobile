import * as MediaLibrary from "expo-media-library";
import { listReclaimable } from "./ledger";
import { checkFingerprints } from "./api";

export interface ReclaimPlan {
  /** Assets safe to remove from the device. */
  ids: string[];
  /** How much space removing them frees. */
  bytes: number;
  /**
   * Backed up according to the local ledger, but NOT confirmed by the server
   * just now - kept on the device. There is no in-app restore yet, so an
   * unverifiable asset is never deleted on the strength of local bookkeeping
   * alone.
   */
  unverifiable: number;
}

/**
 * Works out what can safely be removed from the device, re-checking every
 * candidate against the workspace immediately beforehand.
 *
 * The ledger says an asset was uploaded once. It cannot know whether the file
 * still exists - the user may have deleted it from the web app since. Deleting
 * the only remaining copy on that basis is the one failure this feature must
 * never have, so anything the server does not confirm stays put.
 */
export async function buildReclaimPlan(workspaceId: string): Promise<ReclaimPlan> {
  const rows = await listReclaimable(workspaceId);
  if (rows.length === 0) return { ids: [], bytes: 0, unverifiable: 0 };

  const withFp = rows.filter((r) => r.fingerprint);
  let unverifiable = rows.length - withFp.length;

  let existing: Record<string, string> = {};
  try {
    existing = await checkFingerprints(
      workspaceId,
      [...new Set(withFp.map((r) => r.fingerprint as string))],
    );
  } catch {
    // Offline or the check failed - treat everything as unconfirmed rather
    // than assuming the server still has it.
    return { ids: [], bytes: 0, unverifiable: rows.length };
  }

  const ids: string[] = [];
  let bytes = 0;
  for (const r of withFp) {
    if (existing[r.fingerprint as string]) {
      ids.push(r.local_id);
      bytes += r.size;
    } else {
      unverifiable += 1;
    }
  }
  return { ids, bytes, unverifiable };
}

/**
 * Removes the planned originals in one batched call, so the user sees a single
 * OS confirmation instead of one per photo. Returns how many were removed; a
 * declined prompt returns 0 and changes nothing.
 */
export async function runReclaim(plan: ReclaimPlan): Promise<number> {
  if (plan.ids.length === 0) return 0;
  try {
    await MediaLibrary.deleteAssetsAsync(plan.ids);
  } catch {
    // Declined at the OS prompt, or already gone. The files stay backed up
    // either way.
    return 0;
  }
  return plan.ids.length;
}
