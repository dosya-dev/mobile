import { create } from "zustand";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Network from "expo-network";
import { addThermalListener, getThermalState, type ThermalState } from "@/perf/thermal";
import { backupHoldReason, type HoldReason } from "@/backup/policy";
import { useBackupSettings } from "@/backup/settings";
import { useUploadStore } from "./store";
import { usePlayerStore } from "@/player/playerStore";

export const BASE_CONCURRENCY = 3;

/**
 * What a MANUAL run is allowed to ignore. `wifi` is set only after the user
 * confirmed "Back up over mobile data this time?"; `charging` is implied by
 * the tap itself (a manual run has never waited for a charger). Auto runs
 * carry neither, so a Wi-Fi drop or an unplug pauses them.
 */
export interface PolicyOverride {
  wifi: boolean;
  charging: boolean;
}

const NO_OVERRIDE: PolicyOverride = { wifi: false, charging: false };

interface PacingState {
  thermal: ThermalState;
  charging: boolean;
  connected: boolean;
  onWifi: boolean;
  policyOverride: PolicyOverride;
  set: (patch: Partial<Pick<PacingState, "thermal" | "charging" | "connected" | "onWifi" | "policyOverride">>) => void;
}

/**
 * Runtime pacing signals for the upload engine. Thermal state comes from the
 * native module (falls back to "nominal" where unavailable - Expo Go; on
 * Android it holds backup but never slows the user's own uploads); charging
 * from expo-battery; network from expo-network. The engine reads a derived
 * concurrency cap on every pump.
 *
 * Charging and network start optimistic (plugged in, on Wi-Fi) until the first
 * read lands, so a policy hold is never raised on a default nobody measured.
 */
export const usePacing = create<PacingState>((set) => ({
  thermal: "nominal",
  charging: true,
  connected: true,
  onWifi: true,
  policyOverride: NO_OVERRIDE,
  set: (patch) => set(patch),
}));

/**
 * The concurrency the engine may use right now:
 * - serious/critical thermal → 0 (pause uploads entirely; "Cooling down…")
 * - fair thermal on battery  → 1 (finish what's queued, gently)
 * - otherwise                → BASE_CONCURRENCY
 */
export function getConcurrencyCap(): number {
  if (Platform.OS !== "ios") return BASE_CONCURRENCY;
  const { thermal, charging } = usePacing.getState();
  if (thermal === "serious" || thermal === "critical") return 0;
  if (thermal === "fair" && !charging) return 1;
  return BASE_CONCURRENCY;
}

/**
 * Why BACKUP uploads are held right now, or null. The user's Wi-Fi-only and
 * charging-only settings used to be checked once, before a run started; a run
 * that then left Wi-Fi kept uploading over mobile data. This is the live
 * check the pump and the scan consult. Manual uploads never wait on it.
 */
export function getBackupHold(): HoldReason | "keeping cool" | null {
  const { thermal, connected, onWifi, charging, policyOverride } = usePacing.getState();
  const settings = useBackupSettings.getState().settings;
  const named = backupHoldReason(
    {
      wifiOnly: settings.wifiOnly && !policyOverride.wifi,
      chargingOnly: settings.chargingOnly && !policyOverride.charging,
    },
    { connected, onWifi, charging },
  );
  if (named) return named;
  return autoBackupHeld(thermal, usePlayerStore.getState().listening, policyOverride.charging) ? "keeping cool" : null;
}

/** Automatic backups wait out music and heat. A run the user started (the tap implies policyOverride.charging) does not. */
function autoBackupHeld(thermal: ThermalState, musicPlaying: boolean, manualRun: boolean): boolean {
  return !manualRun && (thermal === "serious" || thermal === "critical" || musicPlaying);
}

/** What the Backup screen shows: the hold above, or iOS's cap on all uploads. */
export function backupCoolingDown(thermal: ThermalState, musicPlaying: boolean, manualRun: boolean): boolean {
  if (autoBackupHeld(thermal, musicPlaying, manualRun)) return true;
  return Platform.OS === "ios" && (thermal === "serious" || thermal === "critical");
}

/** The cap for backup (`bk_`) items: 0 while a policy hold is in force. */
export function getBackupConcurrencyCap(): number {
  return getBackupHold() ? 0 : getConcurrencyCap();
}

/** True while uploads are paused purely to let the device cool down. */
export function isCoolingDown(): boolean {
  if (Platform.OS !== "ios") return false;
  const t = usePacing.getState().thermal;
  return t === "serious" || t === "critical";
}

let monitorStarted = false;
let kick: (() => void) | null = null;
// The caps as of the last change this module saw. A settings change reaches
// us AFTER the store has moved, so "before" has to be remembered, not read.
let lastCaps: [number, number] = [BASE_CONCURRENCY, BASE_CONCURRENCY];

/** Both caps, so a change to either can re-arm the pump. */
function caps(): [number, number] {
  return [getConcurrencyCap(), getBackupConcurrencyCap()];
}

/** Compare the current caps with the remembered ones; kick the pump on a rise. */
function reconcile(): void {
  const now = caps();
  if (now[0] > lastCaps[0] || now[1] > lastCaps[1]) kick?.();
  lastCaps = now;
}

function apply(mutate: () => void): void {
  lastCaps = caps();
  mutate();
  reconcile();
}

/**
 * Grant or withdraw a manual run's permission to ignore policy. Re-arms the
 * pump when the grant lifts a hold, so the run starts moving at once.
 */
export function setPolicyOverride(override: PolicyOverride): void {
  apply(() => usePacing.getState().set({ policyOverride: { ...override } }));
}

/**
 * True between the first tap of a manual run and the moment the screen's loop
 * over destinations returns. NOT the same as "the run is over": runBackup
 * resolves when the SCAN ends, with its uploads still draining.
 */
let manualSequenceActive = false;

/** Any backup upload still queued or in flight. */
function backupUploadsInFlight(): boolean {
  return useUploadStore.getState().items.some(
    (i) => i.id.startsWith("bk_") && (i.status === "queued" || i.status === "uploading"),
  );
}

/**
 * A manual run begins, carrying the user's answer to "back up over mobile data
 * this time?". A manual run never waits for a charger (it never has), so that
 * half is implied by the tap itself.
 */
export function beginManualRunOverride(overMobileData: boolean): void {
  manualSequenceActive = true;
  setPolicyOverride({ wifi: overMobileData, charging: true });
}

/**
 * The screen's loop over destinations has returned. The permission is only
 * withdrawn if nothing is still uploading - otherwise it stands until the last
 * item settles (see maybeWithdrawPolicyOverride, called from backup/completion).
 */
export function endManualRunSequence(): void {
  manualSequenceActive = false;
  maybeWithdrawPolicyOverride();
}

/**
 * Withdraw the manual permission once the run it belongs to is really over:
 * the screen's sequence has ended AND no backup upload is left.
 *
 * Withdrawing any earlier re-armed the Wi-Fi hold against the run's own queue -
 * the few items already in flight finished and every other item sat `queued`
 * until the user found the Backup tab again.
 */
export function maybeWithdrawPolicyOverride(): void {
  if (manualSequenceActive || backupUploadsInFlight()) return;
  const { policyOverride } = usePacing.getState();
  if (!policyOverride.wifi && !policyOverride.charging) return;
  setPolicyOverride(NO_OVERRIDE);
}

/**
 * Hand the permission back NOW, whatever the sequence or the queue think.
 *
 * For the paths that end a run without any item ever settling: a manual Stop
 * (which deletes the in-flight items itself, so the completion subscription
 * never sees a last settle) and the sign-out purge. Those are the two ways a
 * grant used to outlive its run - and, through the purge, reach the next
 * account - leaving Wi-Fi-only quietly unenforced for the rest of the process.
 */
export function resetManualRunOverride(): void {
  manualSequenceActive = false;
  setPolicyOverride(NO_OVERRIDE);
}

/**
 * Start watching thermal + charging + network signals (idempotent).
 * `onCapIncrease` is called whenever either cap rises so the caller can kick
 * the upload pump - that's what auto-resumes a thermally-paused queue, and a
 * backup paused for Wi-Fi or a charger.
 */
export function startPacingMonitor(onCapIncrease: () => void): void {
  if (monitorStarted) return;
  monitorStarted = true;
  kick = onCapIncrease;

  const update = (patch: Partial<Pick<PacingState, "thermal" | "charging" | "connected" | "onWifi">>) =>
    apply(() => usePacing.getState().set(patch));

  usePacing.getState().set({ thermal: getThermalState() });
  addThermalListener((state) => update({ thermal: state }));

  // The store has already moved when this runs, which is what reconcile expects.
  usePlayerStore.subscribe((s, prev) => {
    if (s.listening !== prev.listening) reconcile();
  });
  lastCaps = caps();

  const isCharging = (s: Battery.BatteryState) => s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL;
  Battery.getBatteryStateAsync()
    .then((s) => update({ charging: isCharging(s) }))
    .catch(() => {});
  try {
    Battery.addBatteryStateListener(({ batteryState }) => update({ charging: isCharging(batteryState) }));
  } catch {
    /* battery events unavailable - cap falls back to thermal-only */
  }

  const fromNet = (n: { type?: Network.NetworkStateType | string; isConnected?: boolean } | null | undefined) => ({
    connected: n?.isConnected ?? true,
    onWifi: n?.type === Network.NetworkStateType.WIFI,
  });
  try {
    Network.getNetworkStateAsync()
      .then((n) => { if (n) update(fromNet(n)); })
      .catch(() => {});
  } catch {
    /* network state unavailable - stays optimistic */
  }
  try {
    Network.addNetworkStateListener((e) => update(fromNet(e)));
  } catch {
    /* network events unavailable - the pre-run policy check still applies */
  }

  // Relaxing Wi-Fi-only or charging-only mid-hold must release the queue
  // without waiting for the next network or battery event.
  useBackupSettings.subscribe((s, prev) => {
    if (s.settings.wifiOnly === prev.settings.wifiOnly && s.settings.chargingOnly === prev.settings.chargingOnly) return;
    reconcile();
  });
}

// Test hook: reset the idempotence guard.
export function __resetPacingMonitor(): void {
  monitorStarted = false;
  kick = null;
  manualSequenceActive = false;
  lastCaps = [BASE_CONCURRENCY, BASE_CONCURRENCY];
}
