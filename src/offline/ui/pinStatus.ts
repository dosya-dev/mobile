import { t } from "@/lib/i18n";
import { timeAgo } from "@/files/workspace-format";
import { currentSession } from "../session";
import { listFiles, listMembers } from "../db";
import type { PinRow } from "../types";

/** What the Offline screen says about one pin beyond its status. */
export interface PinSummary {
  /** Files the pin covers. */
  files: number;
  /** Of those, how many have a saved version on the phone. */
  saved: number;
  /** Bytes the pin's saved files (and their office PDFs) hold. */
  bytes: number;
}

const EMPTY: PinSummary = { files: 0, saved: 0, bytes: 0 };

/** Per-pin counts and sizes, read from the offline database. Empty when there is no session. */
export async function loadPinSummaries(): Promise<Map<string, PinSummary>> {
  const s = currentSession();
  const out = new Map<string, PinSummary>();
  if (!s) return out;
  const [members, files] = await Promise.all([listMembers(s), listFiles(s)]);
  const byId = new Map(files.map((f) => [f.file_id, f]));
  for (const m of members) {
    const f = byId.get(m.file_id);
    const cur = out.get(m.pin_id) ?? { ...EMPTY };
    cur.files += 1;
    if (f && f.saved_version != null) {
      cur.saved += 1;
      cur.bytes += (f.saved_size ?? 0) + (f.rendition_size ?? 0);
    }
    out.set(m.pin_id, cur);
  }
  return out;
}

export function summaryFor(map: ReadonlyMap<string, PinSummary>, pinId: string): PinSummary {
  return map.get(pinId) ?? EMPTY;
}

const ago = (ms: number, nowMs: number) => timeAgo(Math.floor(ms / 1000), Math.floor(nowMs / 1000));

/**
 * The status line under a pin (the plan's Task 11). A pin that is waiting on
 * Wi-Fi, space or the budget says so differently when a saved version is
 * already on the phone: that copy still opens, only its update waits.
 */
export function pinStatusLine(pin: PinRow, summary: PinSummary, nowMs: number = Date.now()): string {
  const hasSaved = summary.saved > 0;
  switch (pin.status) {
    case "ready":
      return pin.last_checked_at != null
        ? t("offline.status.checkedRelative", { relative: ago(pin.last_checked_at, nowMs) })
        : t("offline.status.notCheckedYet");
    case "update_pending":
      return t("offline.label.savedVersionUpdatePending");
    case "waiting_wifi":
      return hasSaved ? t("offline.status.savedVersionUpdateWaitingForWiFi") : t("offline.status.waitingForWiFi");
    case "no_space":
      return hasSaved ? t("offline.status.savedVersionUpdateWaitingForSpace") : t("offline.status.notEnoughSpaceOnThisPhone");
    case "over_budget":
      return hasSaved ? t("offline.status.savedVersionUpdateWaitingForBudget") : t("offline.status.overYourOfflineStorageBudget");
    case "error":
      return pin.last_checked_at != null
        ? t("offline.status.couldnTCheckLastCheckedRelative", { relative: ago(pin.last_checked_at, nowMs) })
        : t("offline.status.couldnTCheck");
    case "gone":
      return t("offline.status.youNoLongerHaveAccess");
    case "checking":
      return t("offline.status.checkingForChanges");
    case "transferring":
      return t("offline.status.downloading");
    case "pending":
    default:
      return t("offline.status.waitingToDownload");
  }
}
