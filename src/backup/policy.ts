import * as Network from "expo-network";
import * as Battery from "expo-battery";
import type { BackupSettings } from "./settings";

export interface PolicyInputs {
  connected: boolean;
  onWifi: boolean;
  charging: boolean;
  batteryPercent: number; // 0..100
}

export interface PolicyDecision {
  ok: boolean;
  reason?: "offline" | "waiting-for-wifi" | "waiting-for-charge" | "low-battery";
}

export function shouldRunBackup(settings: BackupSettings, inputs: PolicyInputs): PolicyDecision {
  if (!inputs.connected) return { ok: false, reason: "offline" };
  if (settings.wifiOnly && !inputs.onWifi) return { ok: false, reason: "waiting-for-wifi" };
  if (settings.chargingOnly && !inputs.charging) return { ok: false, reason: "waiting-for-charge" };
  if (!inputs.charging && inputs.batteryPercent < settings.minBatteryPercent) {
    return { ok: false, reason: "low-battery" };
  }
  return { ok: true };
}

/** Why an in-progress backup is waiting, in the words the Backup screen shows. */
export type HoldReason = "waiting for Wi-Fi" | "waiting for charger" | "offline";

/**
 * The mid-run counterpart of shouldRunBackup: whether backup uploads must
 * pause RIGHT NOW because the network or the charger changed under a run
 * that was allowed to start. Only the two user-visible toggles apply here -
 * the battery floor is a start gate, and pausing a run that is already
 * halfway through at 19% would only strand it.
 */
export function backupHoldReason(
  settings: Pick<BackupSettings, "wifiOnly" | "chargingOnly">,
  inputs: Pick<PolicyInputs, "connected" | "onWifi" | "charging">,
): HoldReason | null {
  if (!inputs.connected) return "offline";
  if (settings.wifiOnly && !inputs.onWifi) return "waiting for Wi-Fi";
  if (settings.chargingOnly && !inputs.charging) return "waiting for charger";
  return null;
}

export async function readPolicyInputs(): Promise<PolicyInputs> {
  const net = await Network.getNetworkStateAsync();
  const power = await Battery.getPowerStateAsync();
  const charging =
    power.batteryState === Battery.BatteryState.CHARGING ||
    power.batteryState === Battery.BatteryState.FULL;
  return {
    connected: net.isConnected ?? false,
    onWifi: net.type === Network.NetworkStateType.WIFI,
    charging,
    batteryPercent: Math.round((power.batteryLevel ?? 0) * 100),
  };
}
