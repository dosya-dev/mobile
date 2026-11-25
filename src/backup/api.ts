import { apiRequest } from "@/api";
import { ensureDeviceId } from "@/lib/deviceId";

export async function checkFingerprints(workspaceId: string, fingerprints: string[]): Promise<Record<string, string>> {
  if (fingerprints.length === 0) return {};
  const res = await apiRequest<{ ok: true; existing: Record<string, string> }>("/api/backup/check", {
    method: "POST",
    body: { workspace_id: workspaceId, fingerprints },
  });
  return res.existing ?? {};
}

export async function recordFingerprint(workspaceId: string, fingerprint: string, fileId: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/backup/record", {
    method: "POST",
    body: { workspace_id: workspaceId, fingerprint, file_id: fileId },
  });
}

/**
 * Tell the server that backup has paused, so it becomes a real notification
 * (spec §5.9 `backup_failed`) instead of a tray alert nobody else can see.
 *
 * The device id travels on `X-Dosya-Device`, attached by `apiRequest` from the
 * resolved value - so `ensureDeviceId()` is awaited first rather than trusted
 * to have landed. Without a device id the endpoint refuses the report: the
 * notification's dedupe key is `backup_failed:{deviceId}`, and falling back to
 * the account would merge two handsets into one suppression.
 *
 * Only codes and numbers go out. The engine's own reason string is an API
 * error message, and the server renders {reason} into a push payload and an
 * email body - see apps/api/src/lib/notifications/backup.ts.
 */
export async function reportBackupPause(report: {
  reasonCode: string;
  deviceKind: string;
  pendingCount: number;
  pendingBytes: number;
}): Promise<void> {
  await ensureDeviceId();
  await apiRequest<{ ok: true }>("/api/backup/alert", {
    method: "POST",
    body: {
      reason_code: report.reasonCode,
      device_kind: report.deviceKind,
      pending_count: report.pendingCount,
      pending_bytes: report.pendingBytes,
    },
  });
}
