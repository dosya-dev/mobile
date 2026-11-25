// When the phone may read photos for Personas, in the foreground (the WebView
// reader, which only lives while the app is in front) and in the background
// (a background window or service, see allows()). The rules are the pure
// gateDecision below: a connection, Wi-Fi unless "Use mobile data" is on, a
// cool phone, and the read mode (only while open / while charging / any time,
// which stops below 20% battery and in Low Power Mode). An unknown network,
// charger or battery state counts as "not yet".
//
// The gate looks like the document engine-host's read loop watches on the
// web: `hidden` and a "visibilitychange" event whenever it flips.
import { AppState } from "react-native";
import * as Battery from "expo-battery";
import * as Network from "expo-network";
import { getThermalState, type ThermalState } from "@/perf/thermal";
import { usePlayerStore } from "@/player/playerStore";
import { loadReadSettings, readSettings, subscribeReadSettings, type ReadSettings } from "./settings";

export type HeldReason = "wifi" | "charger" | "battery" | "lowPower" | "thermal";

export interface GateInput {
  active: boolean;
  connected: boolean | null;
  onWifi: boolean;
  charging: boolean | null;
  /** 0..1, null when unknown. */
  battery: number | null;
  lowPower: boolean;
  thermal: ThermalState;
  musicPlaying: boolean;
  settings: ReadSettings;
}

const LOW_BATTERY = 0.2;

/** May the phone read now, `where`? `held` names what it is waiting for, if anything. */
export function gateDecision(i: GateInput, where: "foreground" | "background"): { open: boolean; held: HeldReason | null } {
  const closed = { open: false, held: null };
  const hold = (held: HeldReason) => ({ open: false, held });
  if (i.connected !== true) return closed;
  const { mode, mobileData } = i.settings;
  if (where === "background" && mode === "open") return closed;
  if (where === "foreground" && !i.active) return closed;
  if (!i.onWifi && !mobileData) return hold("wifi");
  if (i.thermal === "serious" || i.thermal === "critical") return hold("thermal");
  // Behind the scenes only: reading with the app open is something the user is doing.
  if (where === "background" && i.musicPlaying) return closed;
  if (mode === "anytime") {
    if (i.lowPower) return hold("lowPower");
    if (i.charging !== true && (i.battery === null || i.battery < LOW_BATTERY)) return hold("battery");
    return { open: true, held: null };
  }
  return i.charging === true ? { open: true, held: null } : hold("charger");
}

export interface GateSignals {
  appActive(): boolean;
  onAppActive(fn: (active: boolean) => void): () => void;
  network(): Promise<{ connected: boolean; onWifi: boolean }>;
  onNetwork(fn: (n: { connected: boolean; onWifi: boolean }) => void): () => void;
  charging(): Promise<boolean>;
  onCharging(fn: (charging: boolean) => void): () => void;
  /** 0..1, or null when the phone cannot say. */
  batteryLevel(): Promise<number | null>;
  onBatteryLevel(fn: (level: number | null) => void): () => void;
  lowPower(): Promise<boolean>;
  onLowPower(fn: (on: boolean) => void): () => void;
  thermal(): ThermalState;
  /** Background reading waits for it: audio keeps the app awake, and reading on top warms the phone. */
  musicPlaying(): boolean;
  onMusicPlaying(fn: (playing: boolean) => void): () => void;
  /** Calls `fn` every minute until the returned function is called (injectable for tests). */
  poll(fn: () => void): () => void;
}

/** Where the read mode and mobile-data choice come from. */
export interface SettingsSource {
  get(): ReadSettings;
  subscribe(fn: () => void): () => void;
}

export interface ReadGate {
  /** The foreground read loop may not read. */
  readonly hidden: boolean;
  /** Connected, but waiting for something (the progress card says so). */
  readonly held: boolean;
  /** What the foreground is waiting for, if anything. */
  readonly heldReason: HeldReason | null;
  /** May a background window or service read now? */
  allows(where: "background"): boolean;
  /** Called whenever `hidden`, `heldReason` or `allows("background")` changes. */
  subscribe(fn: () => void): () => void;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
  stop(): void;
}

export function createReadGate(signals: GateSignals, source: SettingsSource): ReadGate {
  const input: Omit<GateInput, "settings"> = {
    active: signals.appActive(),
    connected: null,
    onWifi: false,
    charging: null,
    battery: null,
    lowPower: false,
    thermal: signals.thermal(),
    musicPlaying: signals.musicPlaying(),
  };
  let stopped = false;
  const fns = new Set<() => void>();
  const subs = new Set<() => void>();

  const evaluate = () => {
    const i: GateInput = { ...input, settings: source.get() };
    return { fg: gateDecision(i, "foreground"), bg: gateDecision(i, "background").open };
  };
  let cur = evaluate();
  const update = () => {
    if (stopped) return;
    const next = evaluate();
    const hiddenChanged = next.fg.open !== cur.fg.open;
    const changed = hiddenChanged || next.fg.held !== cur.fg.held || next.bg !== cur.bg;
    cur = next;
    if (hiddenChanged) for (const fn of [...fns]) fn();
    if (changed) for (const fn of [...subs]) fn();
  };
  const setNet = (n: { connected: boolean; onWifi: boolean }) => {
    input.connected = n.connected;
    input.onWifi = n.onWifi;
    update();
  };
  const setPower = (c: boolean) => { input.charging = c; update(); };
  const setLevel = (l: number | null) => { input.battery = l; update(); };
  const setLow = (on: boolean) => { input.lowPower = on; update(); };
  const readThermal = () => { input.thermal = signals.thermal(); update(); };

  const offs = [
    signals.onAppActive((a) => { input.active = a; update(); }),
    signals.onNetwork(setNet),
    signals.onCharging(setPower),
    signals.onBatteryLevel(setLevel),
    signals.onLowPower(setLow),
    source.subscribe(update),
    signals.poll(readThermal),
    signals.onMusicPlaying((p) => { input.musicPlaying = p; update(); }),
  ];
  // Unreadable: assume a connection but not Wi-Fi, so only mobile data reads
  // (a failed request is then the read loop's ordinary retry).
  signals.network().then(setNet, () => setNet({ connected: true, onWifi: false }));
  signals.charging().then(setPower, () => setPower(false));
  signals.batteryLevel().then(setLevel, () => setLevel(null));
  signals.lowPower().then(setLow, () => setLow(false));

  return {
    get hidden() {
      return !cur.fg.open;
    },
    get held() {
      return cur.fg.held !== null;
    },
    get heldReason() {
      return cur.fg.held;
    },
    allows() {
      return cur.bg;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    addEventListener(_type, fn) {
      fns.add(fn);
    },
    removeEventListener(_type, fn) {
      fns.delete(fn);
    },
    stop() {
      stopped = true;
      fns.clear();
      subs.clear();
      for (const off of offs) off();
    },
  };
}

const THERMAL_POLL_MS = 60_000;
const isCharging = (s: Battery.BatteryState) => s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL;
const fromNet = (n: { type?: unknown; isConnected?: boolean | null } | null | undefined) => ({
  connected: n?.isConnected === true,
  onWifi: n?.type === Network.NetworkStateType.WIFI,
});

/** The phone's own signals: AppState, expo-network and expo-battery. */
export const appSignals: GateSignals = {
  appActive: () => AppState.currentState === "active",
  onAppActive(fn) {
    const sub = AppState.addEventListener("change", (s) => fn(s === "active"));
    return () => sub.remove();
  },
  network: async () => fromNet(await Network.getNetworkStateAsync()),
  onNetwork(fn) {
    try {
      const sub = Network.addNetworkStateListener((e) => fn(fromNet(e)));
      return () => sub.remove();
    } catch {
      return () => undefined;
    }
  },
  charging: async () => isCharging(await Battery.getBatteryStateAsync()),
  onCharging(fn) {
    try {
      const sub = Battery.addBatteryStateListener(({ batteryState }) => fn(isCharging(batteryState)));
      return () => sub.remove();
    } catch {
      return () => undefined;
    }
  },
  // expo-battery reports -1 where it cannot read the level (simulators).
  batteryLevel: async () => {
    const l = await Battery.getBatteryLevelAsync();
    return l >= 0 ? l : null;
  },
  onBatteryLevel(fn) {
    try {
      const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => fn(batteryLevel >= 0 ? batteryLevel : null));
      return () => sub.remove();
    } catch {
      return () => undefined;
    }
  },
  lowPower: () => Battery.isLowPowerModeEnabledAsync(),
  onLowPower(fn) {
    try {
      const sub = Battery.addLowPowerModeListener(({ lowPowerMode }) => fn(lowPowerMode));
      return () => sub.remove();
    } catch {
      return () => undefined;
    }
  },
  // No thermal listener API worth relying on in the background: poll.
  thermal: getThermalState,
  musicPlaying: () => usePlayerStore.getState().listening,
  onMusicPlaying: (fn) => usePlayerStore.subscribe((s, prev) => {
    if (s.listening !== prev.listening) fn(s.listening);
  }),
  poll(fn) {
    const id = setInterval(fn, THERMAL_POLL_MS);
    return () => clearInterval(id);
  },
};

/** The app's gate over its own signals and the stored choice. */
export function appReadGate(): ReadGate {
  void loadReadSettings();
  return createReadGate(appSignals, { get: readSettings, subscribe: subscribeReadSettings });
}
