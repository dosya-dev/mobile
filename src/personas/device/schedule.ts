// Which OS windows Personas asks for (spec 5.3, 5.4, 11.2): planSchedule is
// the pure policy, syncPersonasSchedule gathers the state and applies it, and
// watchPersonasSchedule (mounted in app/_layout.tsx) syncs on every app state
// change and whenever the read mode, the reader, the signed-in user or the
// background gate changes.
//
// iOS: a processing request (on power for "While charging") whenever the app
// goes to the background with work left; ./background.ts asks again after
// each window that ends with more left.
// Android: the foreground service can only start while the app is in front
// (Android 12+), so it is started then, whenever the background gate is open,
// notifications are allowed (else the worker reads) and there is work left; it shows its notification while the app is open
// and hands JS a window each time the app goes to the background. It stops
// when the gate closes, nothing is left, on Pause, when the remote switch
// turns background reading off, at sign-out or in "Only while dosya is
// open"; coming back to the front leaves it up. WorkManager (charging /
// battery not low / unmetered) is enqueued each time the app goes to the
// background, for a phone plugged in later with dosya closed.
import { AppState, Platform as RNPlatform } from "react-native";
import * as bg from "../../../modules/dosya-personas-background";
import { cancelPersonasBackground, personasWorkLeft, startPersonasService, stopPersonasService, type WindowGate } from "./background";
import { personasBackgroundStrings } from "./background-strings";
import { devicePolicy, effectiveBackgroundMode, type DevicePolicy } from "./policy";
import { refreshReaderKind, subscribeReaderKind } from "./reader-kind";
import { loadReadSettings, subscribeReadSettings, type ReadSettings } from "./settings";
import { personasUser, subscribePersonasUser } from "./teardown";

export type Platform = "ios" | "android";

export interface ScheduleState {
  platform: Platform;
  appState: "active" | "background" | "inactive";
  settings: ReadSettings;
  policy: DevicePolicy;
  /** The native reader is in the build and its models are on disk. */
  readerReady: boolean;
  /** A ready, unpaused workspace has photos left. */
  workLeft: boolean;
  /** gate.allows("background") now (Android only; iOS leaves it to the window). */
  gateBackgroundOpen: boolean;
  /**
   * Android: the app may post notifications. Without them the service would
   * run with no notification the user can see or pause from: the worker
   * reads instead.
   */
  notificationsOn: boolean;
  signedIn: boolean;
}

export type ScheduleAction =
  | { kind: "cancelAll" }
  | { kind: "stopService" }
  | { kind: "iosSchedule"; requiresPower: boolean }
  | { kind: "androidService" }
  | { kind: "androidWorker"; requiresCharging: boolean; batteryNotLow: boolean; unmetered: boolean };

const CANCEL_ALL: ScheduleAction[] = [{ kind: "cancelAll" }];

export function planSchedule(s: ScheduleState): ScheduleAction[] {
  const mode = effectiveBackgroundMode(s.settings.mode, s.policy);
  if (!s.signedIn || mode === "none" || mode === "open" || !s.readerReady || !s.workLeft) return CANCEL_ALL;
  if (s.platform === "ios") return s.appState === "background" ? [{ kind: "iosSchedule", requiresPower: mode === "charging" }] : [];
  const out: ScheduleAction[] = [];
  if (!s.gateBackgroundOpen || !s.notificationsOn) out.push({ kind: "stopService" });
  else if (s.appState === "active") out.push({ kind: "androidService" });
  if (s.appState === "background") {
    out.push({ kind: "androidWorker", requiresCharging: mode === "charging", batteryNotLow: mode === "anytime", unmetered: !s.settings.mobileData });
  }
  return out;
}

export interface ScheduleDeps {
  platform: Platform;
  appState(): ScheduleState["appState"];
  signedIn(): boolean;
  settings(): Promise<ReadSettings>;
  readerReady(): Promise<boolean>;
  policy(): Promise<DevicePolicy>;
  workLeft(): Promise<boolean>;
  gateBackgroundOpen(): boolean;
  /** Android: notifications are allowed (backgroundBlocks() does not include "notificationsOff"). */
  notificationsOn(): Promise<boolean>;
  apply(actions: ScheduleAction[]): Promise<void>;
  /** How long the remote switch and the work count (asked together) may take before the sync goes on without them. */
  boundMs: number;
  /** The same on iOS going to the background, where iOS suspends the app within a few seconds. */
  quickBoundMs: number;
}

const POLICY_FALLBACK: DevicePolicy = { background: "on", maxPhotosPerWindow: 2000 };

/** `p`, or `fallback` once `ms` pass (iOS gives a backgrounding app a few seconds). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((r) => {
      timer = setTimeout(() => r(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const asAppState = (s: string): ScheduleState["appState"] => (s === "active" || s === "inactive" ? s : "background");

/* eslint-disable @typescript-eslint/no-require-imports */
const engineHost = () => require("./engine-host") as typeof import("./engine-host");

// engine-host's signals (its gate, this phone's reading state, the work),
// attached once a sync has loaded engine-host: a phone that never reads in
// the background never loads the engine for this.
const hostFns = new Set<() => void>();
const hostChanged = () => {
  for (const fn of [...hostFns]) fn();
};
let hostAttached = false;
let watchedGate: WindowGate | null = null;
let offGate: () => void = () => undefined;

function attachHost(): void {
  if (hostAttached) return;
  hostAttached = true;
  const host = engineHost();
  host.subscribePersonasDevice(hostChanged);
  host.subscribePersonasWork(hostChanged);
}

function gateOpen(): boolean {
  attachHost();
  // A sign-out makes a new gate: follow it.
  const gate = engineHost().personasReadGate();
  if (gate !== watchedGate) {
    offGate();
    watchedGate = gate;
    offGate = gate.subscribe(hostChanged);
  }
  return gate.allows("background");
}

async function applyPlan(actions: ScheduleAction[]): Promise<void> {
  for (const a of actions) {
    switch (a.kind) {
      case "cancelAll":
        await cancelPersonasBackground();
        break;
      case "stopService":
        stopPersonasService();
        break;
      case "androidService":
        await startPersonasService();
        break;
      case "iosSchedule":
        await bg.scheduleWindow({ requiresPower: a.requiresPower });
        break;
      case "androidWorker":
        await bg.enqueueWorker({
          requiresCharging: a.requiresCharging,
          batteryNotLow: a.batteryNotLow,
          unmetered: a.unmetered,
          tapText: personasBackgroundStrings().tapText,
        });
        break;
    }
  }
}

const appScheduleDeps = (): ScheduleDeps => ({
  platform: RNPlatform.OS === "ios" ? "ios" : "android",
  appState: () => asAppState(AppState.currentState),
  signedIn: () => personasUser() !== null,
  settings: loadReadSettings,
  readerReady: async () => (await refreshReaderKind()) === "native",
  policy: () => devicePolicy(),
  workLeft: () => {
    attachHost();
    return personasWorkLeft();
  },
  gateBackgroundOpen: gateOpen,
  notificationsOn: async () => !(await bg.backgroundBlocks()).includes("notificationsOff"),
  apply: applyPlan,
  boundMs: 4_000,
  quickBoundMs: 2_000,
});
/* eslint-enable @typescript-eslint/no-require-imports */

async function gather(d: ScheduleDeps): Promise<ScheduleState> {
  const s: ScheduleState = {
    platform: d.platform,
    appState: d.appState(),
    settings: { mode: "open", mobileData: false },
    policy: POLICY_FALLBACK,
    readerReady: false,
    workLeft: false,
    gateBackgroundOpen: false,
    notificationsOn: false,
    signedIn: d.signedIn(),
  };
  // Cheapest first, and nothing that asks the server (or makes an engine)
  // for a phone that will not read in the background: most phones never
  // download the models.
  if (!s.signedIn) return s;
  s.settings = await d.settings();
  if (s.settings.mode === "open") return s;
  s.readerReady = await d.readerReady();
  if (!s.readerReady) return s;
  // Asked together, under one bound. Unanswered counts as "on" and as work
  // left: the window checks both again and ends "done" or "policy".
  const ms = s.platform === "ios" && s.appState === "background" ? d.quickBoundMs : d.boundMs;
  [s.policy, s.workLeft] = await Promise.all([within(d.policy(), ms, POLICY_FALLBACK), within(d.workLeft(), ms, true)]);
  const mode = effectiveBackgroundMode(s.settings.mode, s.policy);
  if (mode === "none" || !s.workLeft) return s;
  if (s.platform === "android") {
    s.gateBackgroundOpen = d.gateBackgroundOpen();
    // Unanswered counts as allowed (the native check answers [] on failure too).
    if (s.gateBackgroundOpen) s.notificationsOn = await within(d.notificationsOn(), ms, true);
  }
  return s;
}

let running: Promise<void> | null = null;
let again = false;

/** Gather the state and apply planSchedule. Calls made while one runs fold into one more run. */
export function syncPersonasSchedule(deps?: ScheduleDeps): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const d = deps ?? appScheduleDeps();
  running = (async () => {
    do {
      again = false;
      try {
        await d.apply(planSchedule(await gather(d)));
      } catch {
        /* the next change syncs again */
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

export interface WatchSources {
  sync(): void;
  onAppState(fn: () => void): () => void;
  onSettings(fn: () => void): () => void;
  onReader(fn: () => void): () => void;
  onUser(fn: () => void): () => void;
  /** engine-host's gate, device state and work (only once a sync has loaded engine-host). */
  onHost(fn: () => void): () => void;
}

const appWatchSources = (): WatchSources => ({
  sync: () => void syncPersonasSchedule(),
  onAppState(fn) {
    const sub = AppState.addEventListener("change", fn);
    return () => sub?.remove();
  },
  onSettings: subscribeReadSettings,
  onReader: subscribeReaderKind,
  onUser: subscribePersonasUser,
  onHost(fn) {
    hostFns.add(fn);
    return () => {
      hostFns.delete(fn);
    };
  },
});

/** Sync now and on every change that moves the plan (bursts fold in syncPersonasSchedule). Returns the unsubscribe. */
export function watchPersonasSchedule(src: WatchSources = appWatchSources()): () => void {
  const sync = () => src.sync();
  const offs = [src.onAppState(sync), src.onSettings(sync), src.onReader(sync), src.onUser(sync), src.onHost(sync)];
  sync();
  return () => {
    for (const off of offs) off();
  };
}
