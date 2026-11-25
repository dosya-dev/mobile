import { useOfflineStore } from "../offlineStore";
import type { PinRow } from "../types";

/**
 * What a row or tile says about an item's offline copy. Three states only, so
 * the badge stays a glance: it is on the phone, it is on its way, or the phone
 * holds an older version than dosya does.
 */
export type OfflineBadgeState = "saved" | "transferring" | "update_pending";

const MOVING = new Set<PinRow["status"]>(["pending", "checking", "transferring"]);
const WAITING = new Set<PinRow["status"]>(["update_pending", "waiting_wifi", "no_space", "over_budget", "error"]);

/** A file: saved (and current), saved but behind, or covered by a pin and not here yet. */
export function fileBadgeState(
  fileId: string,
  s: { savedFileIds: ReadonlySet<string>; updatePendingIds: ReadonlySet<string>; pins: readonly PinRow[] },
): OfflineBadgeState | null {
  if (s.updatePendingIds.has(fileId)) return "update_pending";
  if (s.savedFileIds.has(fileId)) return "saved";
  const pin = s.pins.find((p) => p.id === fileId && p.kind === "file");
  if (pin && MOVING.has(pin.status)) return "transferring";
  return null;
}

/** A pinned folder: by its pin's status. A folder inside a pin has no badge of its own. */
export function folderBadgeState(folderId: string, pins: readonly PinRow[]): OfflineBadgeState | null {
  const pin = pins.find((p) => p.id === folderId && p.kind === "folder");
  if (!pin || pin.status === "gone") return null;
  if (pin.status === "ready") return "saved";
  if (MOVING.has(pin.status)) return "transferring";
  if (WAITING.has(pin.status)) return "update_pending";
  return null;
}

export function useOfflineFileState(fileId: string): OfflineBadgeState | null {
  return useOfflineStore((s) => fileBadgeState(fileId, s));
}

export function useOfflineFolderState(folderId: string): OfflineBadgeState | null {
  return useOfflineStore((s) => folderBadgeState(folderId, s.pins));
}

/** True when this exact file or folder is pinned (so its sheet offers Remove from offline). */
export function useIsPinned(id: string): boolean {
  return useOfflineStore((s) => s.pins.some((p) => p.id === id));
}
