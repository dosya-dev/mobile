import type { BackupPhase } from "@/backup/runState";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";

export type EngineStatus = "scanning" | "backing-up" | "cooling" | "holding" | "paused" | "protected" | "ready";

export function deriveEngineStatus(i: {
  phase: BackupPhase;
  hasActiveUploads: boolean;
  blocked: boolean;
  autoBackup: boolean;
  /** Uploads paused by thermal pacing (device too hot); resumes automatically. */
  coolingDown?: boolean;
  /** Uploads held by the network/charger policy mid-run; resumes automatically. */
  holdReason?: string | null;
}): EngineStatus {
  if (i.coolingDown && (i.phase !== "idle" || i.hasActiveUploads)) return "cooling";
  if (i.holdReason && (i.phase !== "idle" || i.hasActiveUploads)) return "holding";
  if (i.phase === "scanning") return "scanning";
  if (i.hasActiveUploads) return "backing-up";
  if (i.blocked) return "paused";
  return i.autoBackup ? "protected" : "ready";
}

// Keys, not text: the words are produced at render, in the current language.
const LABEL_KEYS: Record<EngineStatus, MessageKey> = {
  scanning: "backup.status.scanning",
  cooling: "backup.status.coolingDown",
  holding: "common.status.paused",
  "backing-up": "common.status.backingUp",
  paused: "common.status.paused",
  protected: "backup.status.protected",
  ready: "backup.status.ready",
};

const HOLD_KEYS: Record<string, MessageKey> = {
  offline: "backup.status.pausedOffline",
  "waiting for Wi-Fi": "backup.status.pausedWaitingForWiFi",
  "waiting for charger": "backup.status.pausedWaitingForCharger",
};

/** The one status word the screen shows; a hold names what it waits for. */
export function engineLabel(status: EngineStatus, holdReason?: string | null): string {
  if (status === "holding" && holdReason) {
    const key = HOLD_KEYS[holdReason];
    // An unknown code is never shown raw: the generic "Paused" stands for it.
    return t(key ?? LABEL_KEYS.holding);
  }
  return t(LABEL_KEYS[status]);
}
