// The Personas background window runner (spec 5.2, 11). The OS hands the app
// a window (an iOS BGProcessingTask or continued task, an Android foreground
// service or WorkManager run: see WindowKind) and the native side calls
// runPersonasWindow inside it. With no React tree it hydrates what the
// engines need (the signed-in user and token, the workspace list, the Vault
// runtime), then reads photos with the native reader in batches of 10 until
// the deadline minus 10 s, the gate closes, the remote switch says stop, the
// window's photo cap or the memory ceiling is reached, there is nothing left,
// or the OS expires the window (the signal aborts; the engine journals
// nothing for an aborted read).
//
// One reading run at a time (./read-lock.ts): a window that finds the lock
// taken ends with "busy" (a service window after a short wait; a continued
// window, started from a tap in the app, waits for the app to leave the
// front); the app coming to the foreground aborts the
// window and the foreground loops take over. Every window that ran lets the
// models go when it ends (after its reads have settled), and leaves one row
// in the health log (./health.ts).
//
// This module is imported from the app entry (so a cold background start can
// register its tasks); it loads the engine, the Vault and the network layer
// only when a window runs. definePersonasBackground (called at module scope,
// below) connects the native module's windows to the runner; ./schedule.ts
// decides which windows to ask for.
import { AppState, Platform } from "react-native";
import type { EngineStatus, PersonasEngine } from "@dosya-dev/personas-engine";
import { getMemoryFootprint } from "@/perf/thermal";
import * as bg from "../../../modules/dosya-personas-background";
import { personasBackgroundStrings } from "./background-strings";
import { PersonasUnavailableError } from "./errors";
import { recordWindow, type WindowRecord } from "./health";
import { devicePolicy, effectiveBackgroundMode, type DevicePolicy } from "./policy";
import { appWorkspaceEngines, readingStatuses } from "./progress";
import { acquireReadLock, subscribeReadLock } from "./read-lock";
import { refreshReaderKind } from "./reader-kind";
import { loadReadSettings, type ReadMode } from "./settings";
import { onPersonasTeardown, personasUser } from "./teardown";

export { acquireReadLock, readLockOwner, subscribeReadLock, type ReadLockOwner } from "./read-lock";

/** Who gave the window: iOS processing task / iOS continued task / Android service / Android worker. */
export type WindowKind = "processing" | "continued" | "service" | "worker";

export interface WindowOptions {
  /** Epoch ms when the OS takes the window back; reading stops 10 s before. */
  deadlineMs: number;
  /** Aborted when the OS expires the window. */
  signal: AbortSignal;
  onProgress?(p: { read: number; total: number }): void;
  /** For the health log; "processing" when not given. */
  kind?: WindowKind;
}

export type WindowEnd = {
  /** Whether the native side should ask for another window. */
  moreLeft: boolean;
  /** "cap": the remote switch's maxPhotosPerWindow was reached. */
  reason: "deadline" | "done" | "gate" | "aborted" | "signedOut" | "noReader" | "busy" | "memory" | "policy" | "cap" | "error";
};

export type WindowEngine = Pick<PersonasEngine, "status" | "readSome" | "subscribe">;

export interface WindowGate {
  allows(where: "background"): boolean;
  subscribe(fn: () => void): () => void;
}

export interface WindowDeps {
  /** Restore the session (and what the engines need) without React. */
  hydrate(): Promise<void>;
  user(): string | null;
  /** The native reader is in the build and its models are on disk. */
  readerReady(): Promise<boolean>;
  workspaces(): Promise<string[]>;
  engine(workspaceId: string): WindowEngine;
  gate(): WindowGate;
  policy(): Promise<DevicePolicy>;
  /** The read mode the user chose (loaded from the keychain). */
  mode(): Promise<ReadMode>;
  charging(): Promise<boolean>;
  onTeardown(fn: () => void): () => void;
  /** Called when the app comes to the foreground. */
  onAppActive(fn: () => void): () => void;
  /**
   * Called synchronously when a read fails for a reason that is not the
   * photo's (the reader stopped answering, the network or the session is
   * gone), before the engine sees the error: the window aborts its reads so
   * the photo is not counted as failed, and ends.
   */
  onUnavailable(fn: () => void): () => void;
  /** The native memory-warning event (iOS didReceiveMemoryWarning, Android onTrimMemory). */
  onMemoryWarning(fn: () => void): () => void;
  /** Process footprint in bytes, -1 when unknown. */
  memoryFootprint(): number;
  platform: "ios" | "android";
  /** Let the native reader's models go. */
  unload(): Promise<void>;
  record(r: WindowRecord, error?: unknown): Promise<void>;
  now(): number;
  /** How long a gate that is still reading its signals may take to open. */
  gateWaitMs: number;
  /** How long the window waits for the models to go before it ends anyway. */
  unloadTimeoutMs: number;
  /** After an abort, how long a readSome may take to settle before the window stops waiting for it. */
  abortGraceMs: number;
  /** How long to wait for a read already running on an engine before skipping it for this window. */
  settleWaitMs: number;
  /**
   * A service window: how long to wait for the read lock before ending busy.
   * Native opens it as the app leaves the front, often before the foreground
   * loop has let the lock go, and the service gets no other window until the
   * next background transition. A continued window waits until its deadline
   * (or expiry); other windows end busy at once.
   */
  lockWaitMs?: number;
}

const BATCH = 10;
const DEADLINE_MARGIN_MS = 10_000;
const IOS_MEMORY_CEILING = 600 * 1024 * 1024;
const DEFAULT_MAX_PHOTOS = 2000;

/* eslint-disable @typescript-eslint/no-require-imports */
const engineHost = () => require("./engine-host") as typeof import("./engine-host");

const appDeps = (): WindowDeps => ({
  async hydrate() {
    const { useAuthStore } = require("@/auth/authStore") as typeof import("@/auth/authStore");
    if (useAuthStore.getState().status === "loading") await useAuthStore.getState().hydrate();
    if (useAuthStore.getState().status !== "signedIn") return;
    await (require("@/vault/runtime") as typeof import("@/vault/runtime")).ensureVaultRuntime();
  },
  user: personasUser,
  readerReady: async () => (await refreshReaderKind()) === "native",
  workspaces: () => appWorkspaceEngines().workspaces(),
  engine: (ws) => engineHost().personasEngine(ws),
  gate: () => engineHost().personasReadGate(),
  policy: () => devicePolicy(),
  mode: async () => (await loadReadSettings()).mode,
  charging: () => (require("./gate") as typeof import("./gate")).appSignals.charging(),
  onTeardown: onPersonasTeardown,
  onAppActive(fn) {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") fn();
    });
    return () => sub?.remove();
  },
  onUnavailable: (fn) => engineHost().subscribePersonasUnavailable(fn),
  onMemoryWarning: bg.onMemoryWarning,
  memoryFootprint: getMemoryFootprint,
  platform: Platform.OS === "ios" ? "ios" : "android",
  unload: () => engineHost().unloadPersonasReader(),
  record: recordWindow,
  now: Date.now,
  gateWaitMs: 3_000,
  unloadTimeoutMs: 3_000,
  abortGraceMs: 2_000,
  settleWaitMs: 5_000,
  lockWaitMs: 5_000,
});
/* eslint-enable @typescript-eslint/no-require-imports */

const end = (moreLeft: boolean, reason: WindowEnd["reason"]): WindowEnd => ({ moreLeft, reason });

/** Resolves when `ok()` holds, `signal` aborts or `ms` pass, whichever is first. */
function waitUntil(ok: () => boolean, subscribe: (fn: () => void) => () => void, ms: number, signal: AbortSignal): Promise<void> {
  if (ok() || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let off: () => void = () => undefined;
    const done = () => {
      clearTimeout(timer);
      off();
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
    off = subscribe(() => {
      if (ok()) done();
    });
  });
}

const maxPhotos = (p: DevicePolicy) =>
  Number.isFinite(p.maxPhotosPerWindow) ? Math.max(1, Math.floor(p.maxPhotosPerWindow)) : DEFAULT_MAX_PHOTOS;

export async function runPersonasWindow(opts: WindowOptions, deps: Partial<WindowDeps> = {}): Promise<WindowEnd> {
  const d: WindowDeps = { ...appDeps(), ...deps };
  const kind = opts.kind ?? "processing";
  const at = d.now();
  let mode: ReadMode = "charging";
  let photos = 0;
  const row = (e: WindowEnd): WindowRecord => ({ at, kind, ms: Math.max(0, d.now() - at), photos, end: e.reason, platform: d.platform, mode });

  let release = acquireReadLock(kind);
  // A service window waits a while for the lock: native opens it as the app
  // leaves the front, often before the foreground loop has let the lock go.
  // A continued window ("Keep reading in background") starts from a tap
  // inside the app, while the foreground holds the lock: it waits as long as
  // it has, until the app leaves the front (the foreground lets the lock go),
  // the OS expires it or its deadline comes. Other windows end busy at once.
  const lockWait =
    kind === "service" ? d.lockWaitMs ?? 0
    : kind === "continued" ? Math.max(0, opts.deadlineMs - DEADLINE_MARGIN_MS - d.now())
    : 0;
  if (!release && lockWait > 0) {
    await new Promise<void>((resolve) => {
      let off: () => void = () => undefined;
      const done = () => {
        clearTimeout(timer);
        off();
        opts.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, lockWait);
      opts.signal.addEventListener("abort", done);
      off = subscribeReadLock(() => {
        if (release) return;
        release = acquireReadLock(kind);
        if (release) done();
      });
      if (opts.signal.aborted) done();
    });
  }
  if (!release) {
    const busy = end(true, opts.signal.aborted ? "aborted" : "busy");
    await d.record(row(busy), undefined).catch(() => undefined);
    return busy;
  }
  const releaseLock = release;

  const ac = new AbortController();
  let stop: WindowEnd | null = null;
  const halt = (e: WindowEnd) => {
    stop ??= e;
    ac.abort();
  };
  const offs: (() => void)[] = [];
  const onExpired = () => halt(end(true, "aborted"));
  if (opts.signal.aborted) onExpired();
  else {
    opts.signal.addEventListener("abort", onExpired);
    offs.push(() => opts.signal.removeEventListener("abort", onExpired));
  }
  offs.push(d.onTeardown(() => halt(end(false, "signedOut"))));
  // The app came to the front: its foreground loops read from here on.
  offs.push(d.onAppActive(() => halt(end(true, "aborted"))));
  offs.push(d.onMemoryWarning(() => halt(end(true, "memory"))));
  // Not the photo's fault and not a bug: try again in a later window.
  offs.push(d.onUnavailable(() => halt(end(true, "error"))));
  // At the cut-off the batch in flight is aborted, not waited for.
  const cutoff = setTimeout(() => halt(end(true, "deadline")), Math.max(0, opts.deadlineMs - DEADLINE_MARGIN_MS - d.now()));
  offs.push(() => clearTimeout(cutoff));

  async function run(): Promise<WindowEnd> {
    await d.hydrate();
    if (stop) return stop;
    if (!d.user()) return end(false, "signedOut");
    if (!(await d.readerReady())) return end(false, "noReader");
    mode = await d.mode();
    const gate = d.gate();
    let max = DEFAULT_MAX_PHOTOS;

    // At the start and between batches: the remote switch, the gate, the
    // photo cap, the memory ceiling and the deadline.
    const check = async (): Promise<WindowEnd | null> => {
      if (stop) return stop;
      const policy = await d.policy();
      max = maxPhotos(policy);
      const effective = effectiveBackgroundMode(mode, policy);
      if (effective === "none") return end(false, "policy");
      if (!gate.allows("background")) return end(true, "gate");
      if (effective !== mode && effective === "charging" && !(await d.charging())) return end(true, "gate");
      if (d.platform === "ios" && d.memoryFootprint() > IOS_MEMORY_CEILING) return end(true, "memory");
      if (photos >= max) return end(true, "cap");
      if (d.now() >= opts.deadlineMs - DEADLINE_MARGIN_MS) return end(true, "deadline");
      return stop;
    };

    // A cold start's gate is still reading the network and the charger.
    await waitUntil(() => gate.allows("background"), (fn) => gate.subscribe(fn), d.gateWaitMs, ac.signal);
    const first = await check();
    if (first) return first;
    offs.push(gate.subscribe(() => {
      if (!gate.allows("background")) halt(end(true, "gate"));
    }));

    // Each workspace's status asks the server (once per engine), so a
    // workspace switched off or a revoked membership is not read.
    const engines = (await readingStatuses({ workspaces: d.workspaces, engine: d.engine })).map((s) => s.engine);
    if (stop) return stop;

    const progress = async () => {
      if (!opts.onProgress) return;
      let read = 0;
      let total = 0;
      for (const e of engines) {
        try {
          const st: EngineStatus = await e.status();
          if (st.state === "ready") {
            read += st.read;
            total += st.total ?? 0;
          }
        } catch {
          /* left out of this count */
        }
      }
      try {
        opts.onProgress({ read, total });
      } catch {
        /* the caller's */
      }
    };

    // A read still running on the engine (the foreground's as the app left,
    // or one an earlier window gave up on) makes readSome answer 0 at once:
    // the engine runs one call at a time. Wait for it, for a while; true once
    // the engine is free.
    const settled = async (e: WindowEngine): Promise<boolean> => {
      const giveUpAt = d.now() + d.settleWaitMs;
      for (;;) {
        const st = await e.status();
        if (st.state !== "ready" || !st.reading) return true;
        const wait = giveUpAt - d.now();
        if (stop || wait <= 0) return false;
        await waitUntil(() => false, (fn) => e.subscribe(fn), Math.min(1_000, wait), ac.signal);
      }
    };

    // Once the window is aborted, a readSome waits for the photos in flight;
    // a hung read or a download that ignores the signal would keep it past
    // the OS's deadline. Give it abortGraceMs, then stop waiting: the
    // abandoned call starts nothing new and journals nothing (the engine
    // drops what an aborted call read), and until it settles the engine
    // reports reading, so the next caller waits for it or skips it.
    const readBounded = (e: WindowEngine, n: number): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const call = e.readSome(n, ac.signal);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
          timer = setTimeout(() => {
            ac.signal.removeEventListener("abort", onAbort);
            call.catch(() => undefined);
            resolve(0);
          }, d.abortGraceMs);
        };
        if (ac.signal.aborted) onAbort();
        else ac.signal.addEventListener("abort", onAbort);
        call.then(
          (v) => {
            clearTimeout(timer);
            ac.signal.removeEventListener("abort", onAbort);
            resolve(v);
          },
          (err) => {
            clearTimeout(timer);
            ac.signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        );
      });

    let left = engines;
    let busy = false;
    while (left.length > 0) {
      for (const e of [...left]) {
        const c = await check();
        if (c) return c;
        if (!(await settled(e))) {
          if (stop) return stop;
          // Still reading for someone else: not this window's to read.
          busy = true;
          left = left.filter((x) => x !== e);
          continue;
        }
        if (stop) return stop;
        const n = await readBounded(e, Math.min(BATCH, max - photos));
        photos += n;
        if (stop) return stop;
        if (n === 0) left = left.filter((x) => x !== e);
        await progress();
      }
    }
    return busy ? end(true, "busy") : end(false, "done");
  }

  // Once the window is stopped (expiry, the cut-off, sign-out, the app in
  // front, a memory warning), run() has abortGraceMs to return, whatever it
  // still awaits (hydrate, the remote switch, the workspace list, a status):
  // the window then ends and lets the lock go. An abandoned run() reads
  // nothing more: it checks `stop` before every read.
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let onStopped: () => void = () => undefined;
  const stopped = new Promise<WindowEnd>((resolve) => {
    onStopped = () => {
      graceTimer = setTimeout(() => resolve(stop ?? end(true, "aborted")), d.abortGraceMs);
    };
    if (ac.signal.aborted) onStopped();
    else ac.signal.addEventListener("abort", onStopped);
  });
  offs.push(() => {
    clearTimeout(graceTimer);
    ac.signal.removeEventListener("abort", onStopped);
  });

  let result: WindowEnd;
  let error: unknown;
  try {
    const running = run();
    running.catch(() => undefined);
    result = await Promise.race([running, stopped]);
  } catch (e) {
    if (stop) result = stop;
    else {
      result = end(true, "error");
      // A reader or network that is unavailable is not a bug.
      error = e instanceof PersonasUnavailableError ? undefined : e;
    }
  } finally {
    for (const off of offs) {
      try {
        off();
      } catch {
        /* best effort */
      }
    }
  }
  // Every read has settled (readSome resolved): now let the models go.
  // Bounded: a native read that hangs must not keep the window past the OS's deadline.
  let unloadTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    d.unload().catch(() => undefined),
    new Promise<void>((r) => {
      unloadTimer = setTimeout(r, d.unloadTimeoutMs);
    }),
  ]);
  clearTimeout(unloadTimer);
  releaseLock();
  // Bounded too: the window must end even when the health log cannot be written.
  let recordTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    d.record(row(result), error).catch(() => undefined),
    new Promise<void>((r) => {
      recordTimer = setTimeout(r, d.unloadTimeoutMs);
    }),
  ]);
  clearTimeout(recordTimer);
  return result;
}

/** Any ready, unpaused workspace with photos left (or not counted yet). */
export async function personasWorkLeft(deps: { workspaces(): Promise<string[]>; engine(ws: string): Pick<PersonasEngine, "status"> } = appWorkspaceEngines()): Promise<boolean> {
  try {
    return (await readingStatuses(deps)).some(({ status }) => status.total === null || status.read < status.total);
  } catch {
    return false;
  }
}

// ---- the native windows ----------------------------------------------------

/** What definePersonasBackground connects the native windows to (injectable for tests). */
export interface BackgroundWiring {
  run(opts: WindowOptions): Promise<WindowEnd>;
  /** Notification Pause: the per-device pause on every engine this process hosts. */
  pauseAll(): Promise<void>;
  /** Plan the schedule again (./schedule.ts syncPersonasSchedule). */
  replan(): Promise<void>;
  /** The mode a background window may use now ("none": the remote switch is off) and the mobile-data choice. */
  backgroundMode(): Promise<{ mode: ReadMode | "none"; mobileData: boolean }>;
  onTeardown(fn: () => void): () => void;
  /** The app is in front now. */
  appActive(): boolean;
}

const appWiring = (): BackgroundWiring => ({
  run: (opts) => runPersonasWindow(opts),
  async pauseAll() {
    engineHost().pausePersonasEngines();
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  replan: () => (require("./schedule") as typeof import("./schedule")).syncPersonasSchedule(),
  async backgroundMode() {
    const [settings, policy] = await Promise.all([loadReadSettings(), devicePolicy()]);
    return { mode: effectiveBackgroundMode(settings.mode, policy), mobileData: settings.mobileData };
  },
  onTeardown: onPersonasTeardown,
  appActive: () => AppState.currentState === "active",
});

interface Open {
  ac: AbortController;
  kind: WindowKind;
  /** JS stopped the service under this window: its expiry is not the daily budget running out. */
  stopping: boolean;
  /** pauseEpoch when it opened: a Pause since means it asks for nothing more. */
  epoch: number;
}

/** Windows handed to JS and not yet ended with windowDone, by id. */
const open = new Map<string, Open>();
/** Ids of windows that have ended, for a headless task that asks late (bounded). */
const ended: string[] = [];
const endedFns = new Set<(id: string, kind: WindowKind) => void>();
let pauseEpoch = 0;
/** JS asked for the service and has not stopped it since, nor heard native stop it (onServiceStopped). */
let serviceUp = false;
let defined: { wiring: BackgroundWiring; dispose(): void } | null = null;

/**
 * iOS continued task ("Keep reading in background"): being submitted, or
 * submitted and its window not yet handed over (until CONTINUED_WAIT_MS),
 * or its window open. The People screen hides the button meanwhile, so a
 * second tap does not submit a second task that would only end busy.
 */
let continuedStarting = false;
let continuedPending: ReturnType<typeof setTimeout> | null = null;
const continuedFns = new Set<() => void>();
const CONTINUED_WAIT_MS = 60_000;
let continuedWas = false;

function continuedChanged(): void {
  const now = personasContinuedActive();
  if (now === continuedWas) return;
  continuedWas = now;
  for (const fn of [...continuedFns]) fn();
}

function clearContinuedPending(): void {
  if (continuedPending) clearTimeout(continuedPending);
  continuedPending = null;
}

export function personasContinuedActive(): boolean {
  if (continuedStarting || continuedPending) return true;
  for (const o of open.values()) if (o.kind === "continued") return true;
  return false;
}

export function subscribePersonasContinued(fn: () => void): () => void {
  continuedFns.add(fn);
  return () => {
    continuedFns.delete(fn);
  };
}

/** Submit the continued task unless one is already starting or running. False when not submitted. */
export async function startPersonasContinued(o: { title: string; subtitle: string }): Promise<boolean> {
  if (personasContinuedActive()) return false;
  continuedStarting = true;
  continuedChanged();
  let ok = false;
  try {
    ok = await bg.startContinued(o);
  } finally {
    continuedStarting = false;
    if (ok) {
      continuedPending = setTimeout(() => {
        continuedPending = null;
        continuedChanged();
      }, CONTINUED_WAIT_MS);
    }
    continuedChanged();
  }
  return ok;
}

const BG_MODES = new Set<ReadMode | "none">(["charging", "anytime"]);

/**
 * Android: start the foreground service (only works while the app is in
 * front) unless JS already started it. False when Android refused.
 */
export async function startPersonasService(): Promise<boolean> {
  if (serviceUp) return true;
  const s = personasBackgroundStrings();
  serviceUp = await bg.startService({ title: s.title, text: s.text, pauseLabel: s.pauseLabel, channelName: s.channelName });
  return serviceUp;
}

/** Android: stop the foreground service. A service window still open ends through its expiry, without the WorkManager fallback. */
export function stopPersonasService(): void {
  for (const w of open.values()) if (w.kind === "service") w.stopping = true;
  serviceUp = false;
  bg.stopService();
}

/** Cancel every window request and stop the service. */
export async function cancelPersonasBackground(): Promise<void> {
  stopPersonasService();
  await bg.cancelWindows().catch(() => undefined);
}

function enqueueFor(m: { mode: ReadMode | "none"; mobileData: boolean }): Promise<void> {
  return bg.enqueueWorker({
    requiresCharging: m.mode === "charging",
    batteryNotLow: m.mode === "anytime",
    unmetered: !m.mobileData,
    tapText: personasBackgroundStrings().tapText,
  });
}

function progressTo(id: string, kind: WindowKind, p: { read: number; total: number }): void {
  const text = personasBackgroundStrings(p).text;
  if (kind === "service") bg.updateService({ read: p.read, total: p.total, text });
  else if (kind === "processing" || kind === "continued") bg.setWindowProgress(id, { read: p.read, total: p.total, text });
}

/** After windowDone: what the window's end asks of the schedule. */
async function afterWindow(w: BackgroundWiring, kind: WindowKind, e: WindowEnd, moreLeft: boolean): Promise<void> {
  if (kind === "processing" || kind === "continued") {
    // iOS windowDone does not reschedule.
    if (!moreLeft) return;
    const m = await w.backgroundMode();
    if (BG_MODES.has(m.mode)) await bg.scheduleWindow({ requiresPower: m.mode === "charging" });
  } else if (kind === "service") {
    // The service gives a window only at the next background transition, so
    // a service window that ended while the app is still away leaves its
    // notification up with nothing reading. Stop it and plan again: with
    // work left (and the app in the background) the plan enqueues the worker.
    // Only a window the app took over (aborted, or its deadline with the app
    // back in front) leaves the service up for the next transition; an
    // expiry is windowExpired's.
    if (e.reason === "aborted") return;
    if (e.reason === "deadline" && w.appActive()) return;
    stopPersonasService();
    await w.replan();
  } else {
    // A worker window: native completes the run (and enqueues it again when
    // moreLeft). With nothing left the service has nothing to read either;
    // either way the plan is made again from what is left now.
    if (!moreLeft) stopPersonasService();
    await w.replan();
  }
}

function windowOpened(w: BackgroundWiring, ev: bg.WindowEvent): void {
  const o: Open = { ac: new AbortController(), kind: ev.kind, stopping: false, epoch: pauseEpoch };
  open.set(ev.id, o);
  if (ev.kind === "continued") {
    clearContinuedPending();
    continuedChanged();
  }
  void (async () => {
    let e: WindowEnd;
    try {
      e = await w.run({
        deadlineMs: ev.deadlineMs,
        signal: o.ac.signal,
        kind: ev.kind,
        onProgress: (p) => progressTo(ev.id, ev.kind, p),
      });
    } catch {
      e = end(true, "error");
    }
    open.delete(ev.id);
    if (ev.kind === "continued") continuedChanged();
    const moreLeft = e.moreLeft && o.epoch === pauseEpoch;
    bg.windowDone(ev.id, moreLeft);
    try {
      await afterWindow(w, ev.kind, e, moreLeft);
    } catch {
      /* the next background transition plans again */
    }
    ended.push(ev.id);
    if (ended.length > 20) ended.shift();
    for (const fn of [...endedFns]) fn(ev.id, ev.kind);
  })();
}

function windowExpired(w: BackgroundWiring, id: string): void {
  // Unknown: a window from before a JS reload, or one that has already ended.
  const o = open.get(id);
  if (!o) return;
  o.ac.abort();
  if (o.kind !== "service") return;
  serviceUp = false;
  if (o.stopping) return;
  // Android 15's daily budget for the service ran out: WorkManager takes over (spec 5.4).
  void w
    .backgroundMode()
    .then((m) => (BG_MODES.has(m.mode) ? enqueueFor(m) : undefined))
    .catch(() => undefined);
}

async function pausePressed(w: BackgroundWiring): Promise<void> {
  // Spec 10: pause Personas on this phone, stop the service, cancel the work.
  pauseEpoch++;
  for (const o of open.values()) o.ac.abort();
  try {
    await w.pauseAll();
  } catch {
    /* the service and the work still go */
  }
  await cancelPersonasBackground();
}

/**
 * Connect the native module's windows to the runner (once per process; later
 * calls are no-ops). Called at module scope so a cold background start
 * listens before native flushes the window it buffered.
 */
export function definePersonasBackground(over: Partial<BackgroundWiring> = {}): void {
  if (defined) return;
  const w: BackgroundWiring = { ...appWiring(), ...over };
  // onWindow first: buffered windows are open before a buffered expiry for them arrives.
  const offs = [
    bg.onWindow((ev) => windowOpened(w, ev)),
    bg.onWindowExpired((id) => windowExpired(w, id)),
    bg.onPausePressed(() => void pausePressed(w)),
    // Native stopped the service with no window to tell us by (onTimeout with
    // the app in front, a refused startForeground): the next plan starts it again.
    bg.onServiceStopped(() => {
      serviceUp = false;
    }),
    w.onTeardown(() => void cancelPersonasBackground()),
  ];
  defined = {
    wiring: w,
    dispose: () => {
      for (const off of offs) off();
    },
  };
}

/** Tests only: forget the wiring and every window. */
export function __resetPersonasBackgroundForTests(): void {
  defined?.dispose();
  defined = null;
  open.clear();
  ended.length = 0;
  endedFns.clear();
  pauseEpoch = 0;
  serviceUp = false;
  continuedStarting = false;
  clearContinuedPending();
  continuedFns.clear();
  continuedWas = false;
}

/** Resolves when window `id` (any worker window when no id) has ended, or after `ms`. */
function windowEnded(id: string | undefined, ms: number): Promise<void> {
  if (id && ended.includes(id)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      endedFns.delete(fn);
      resolve();
    };
    const fn = (endedId: string, kind: WindowKind) => {
      if (id ? endedId === id : kind === "worker") done();
    };
    const timer = setTimeout(done, ms);
    endedFns.add(fn);
  });
}

/** Past the window's deadline: the runner's 10 s margin, the unload and the record. */
const HEADLESS_GRACE_MS = 30_000;
const HEADLESS_MAX_MS = 10 * 60_000;

/**
 * Android's headless task `DosyaPersonasRead` (registered in index.js), which
 * the WorkManager worker starts with `{ id, deadlineMs }`. The window itself
 * arrives through onWindow (buffered natively until JS listens) and runs the
 * same way as every other window; the task only has to keep the headless JS
 * service alive until that window has ended.
 */
export async function personasHeadlessTask(data?: { id?: string; deadlineMs?: number }): Promise<void> {
  // Headless: no React tree has booted the language (the fallback notification
  // and the worker's tap text are worded in it).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await (require("@/lib/i18n") as typeof import("@/lib/i18n")).ensureI18n();
  } catch {
    /* English, then */
  }
  definePersonasBackground();
  const deadline = typeof data?.deadlineMs === "number" && Number.isFinite(data.deadlineMs) ? data.deadlineMs : Date.now() + HEADLESS_MAX_MS;
  const ms = Math.min(HEADLESS_MAX_MS + HEADLESS_GRACE_MS, Math.max(0, deadline - Date.now()) + HEADLESS_GRACE_MS);
  await windowEnded(typeof data?.id === "string" ? data.id : undefined, ms);
}

definePersonasBackground();
