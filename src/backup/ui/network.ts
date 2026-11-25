import { useCallback, useEffect, useState } from "react";
import { readPolicyInputs } from "@/backup/policy";
import { useBackupSettings } from "@/backup/settings";
import { usePacing } from "@/upload/pacing";

export type NetworkKind = "cellular-data" | "waiting-for-wifi" | "offline" | null;

/**
 * Which network condition the Backup page should mention. Pure, so the matrix
 * is testable without rendering:
 * - offline: nothing moves at all
 * - Wi-Fi off + wifiOnly ON  → "waiting for Wi-Fi" (explains why auto backup is idle)
 * - Wi-Fi off + wifiOnly OFF → "this uses mobile data" (the forgot-to-turn-on-wifi case;
 *   also covers manual runs, which never go through the wifiOnly policy gate)
 */
export function deriveNetworkKind(i: {
  connected: boolean;
  onWifi: boolean;
  wifiOnly: boolean;
  backupRelevant: boolean; // auto-backup enabled OR a run is active
}): NetworkKind {
  if (!i.backupRelevant) return null;
  if (!i.connected) return "offline";
  if (i.onWifi) return null;
  return i.wifiOnly ? "waiting-for-wifi" : "cellular-data";
}

export const NETWORK_POLL_MS = 5_000;

/**
 * Live network condition for the Backup dashboard. Polls while mounted (the
 * Backup tab), so flipping Wi-Fi off is reflected within seconds.
 */
export function useNetworkKind(runActive: boolean): NetworkKind {
  const wifiOnlySetting = useBackupSettings((s) => s.settings.wifiOnly);
  const autoBackup = useBackupSettings((s) => s.settings.autoBackup);
  // A run the user chose to make over mobile data is not "waiting for Wi-Fi";
  // it is using mobile data, and the page should say so.
  const cellularAllowedThisRun = usePacing((s) => s.policyOverride.wifi);
  const wifiOnly = wifiOnlySetting && !cellularAllowedThisRun;
  const [net, setNet] = useState<{ connected: boolean; onWifi: boolean } | null>(null);

  const sample = useCallback(async () => {
    try {
      const i = await readPolicyInputs();
      setNet({ connected: i.connected, onWifi: i.onWifi });
    } catch {
      /* network state unavailable - say nothing rather than guess */
    }
  }, []);

  useEffect(() => {
    void sample();
    const t = setInterval(() => void sample(), NETWORK_POLL_MS);
    return () => clearInterval(t);
  }, [sample]);

  if (!net) return null;
  return deriveNetworkKind({
    connected: net.connected,
    onWifi: net.onWifi,
    wifiOnly,
    backupRelevant: autoBackup || runActive,
  });
}
