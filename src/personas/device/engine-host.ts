// Ported from apps/web/src/lib/personas-device/engine-host.ts (via the
// desktop's) - keep them in step.
//
// One PersonasEngine per user and workspace, wired to the phone's ports, plus
// the read loop that feeds it photos. The Personas screens use
// usePersonasEngine; after a Vault unlock or setup they call unlockPersonas
// so the engine can open (or create) the user's personas key.
//
// Mobile differences: the reader is the native one (./native-host.ts) once
// its module is in the build and its models are on disk (./reader-kind.ts),
// otherwise the hidden WebView (./reader.ts, ./channel.ts, ./ReaderHost.tsx);
// the foreground loops read only while the app is in front, hold the read
// lock (./read-lock.ts) so no background window reads at the same time, and
// read only while the gate is open (./gate.ts: Wi-Fi unless "Use mobile data"
// is on, the read mode's charger / battery / Low Power Mode rule, a cool
// phone); the signed-in user is the auth store's
// (./teardown.ts); the Vault is src/vault/store.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { PersonasEngine, type EngineStatus, type FaceReaderPort, type FileSource } from "@dosya-dev/personas-engine";
import { deleteItem, getItem, setItem } from "@/lib/keychain";
import { useVault, vaultPersonasIdentity } from "@/vault/store";
import { personasReaderChannel } from "./channel";
import { PersonasUnavailableError } from "./errors";
import { isNativeFaceReaderAvailable } from "../../../modules/dosya-face-reader";
import { onMemoryWarning } from "../../../modules/dosya-personas-background";
import { appReadGate, type HeldReason, type ReadGate } from "./gate";
import { ensureFaceModels } from "./models";
import { personasNativeReader, setPersonasMemoryWarnings, unloadPersonasNativeReader } from "./native-host";
import { mobileFileSource, mobileJournalApi, secureKeyStore, sqliteLocalCache, type MobileFileSource, type PhotoRow } from "./ports";
import { acquireReadLock, subscribeReadLock } from "./read-lock";
import { createWebViewReader, type WebViewReader } from "./reader";
import { markFaceModelsReady, personasReaderKind, refreshReaderKind, subscribeReaderKind } from "./reader-kind";
import { onPersonasTeardown, personasTornDown, personasUser, subscribePersonasUser } from "./teardown";

// ---- read loop ------------------------------------------------------------

export type LoopEngine = Pick<PersonasEngine, "status" | "readSome" | "subscribe">;

export interface LoopDoc {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
}

export interface LoopOptions {
  /** Stop reading while it is hidden: the phone's read gate. */
  doc: LoopDoc;
  /**
   * False while this phone's WebView cannot run the reader: nothing is read
   * (no rendition is fetched) until it can; the loop waits for the engine to
   * report a change, as while paused.
   */
  canRead?: () => boolean;
  /** Photos per readSome call. */
  batch?: number;
  /** Wait after a call that found nothing to read, or while the engine is not ready. */
  idleMs?: number;
  /** First wait after an error; doubles up to maxRetryMs. */
  retryMs?: number;
  maxRetryMs?: number;
}

export interface ReadLoop {
  stop(): void;
  /** Abort the read in flight and try again after the retry delay. */
  interrupt(): void;
}

const READ_BATCH = 50;
/**
 * Photos in flight at once. The phone runs one reader (the WebView's worker,
 * ~106 MB), so this only lets the next two renditions download while it reads.
 */
const MOBILE_READ_AHEAD = 3;

/**
 * Calls engine.readSome(50) while the gate is open and the engine is ready
 * and not paused: straight again while it finds work, after idleMs when it
 * found none. Closing the gate (the app goes to the background, Wi-Fi or the
 * charger goes, the battery runs low, Low Power Mode comes on, the phone gets
 * hot) aborts the read in flight (the engine journals nothing for a
 * photo whose read was aborted) and nothing more is read until it opens.
 * While the engine is not ready or paused the loop waits for it to report a change.
 */
export function runReadLoop(engine: LoopEngine, opts: LoopOptions): ReadLoop {
  const doc = opts.doc;
  const canRead = opts.canRead ?? (() => true);
  const batch = opts.batch ?? READ_BATCH;
  const idleMs = opts.idleMs ?? 120_000;
  const retryMs = opts.retryMs ?? 30_000;
  const maxRetryMs = opts.maxRetryMs ?? 5 * 60_000;
  let stopped = false;
  let running = false;
  let again = false;
  let waitingForEngine = false;
  let backoff = retryMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: AbortController | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      void step();
    }, ms);
  };
  const retryLater = () => {
    schedule(backoff);
    backoff = Math.min(backoff * 2, maxRetryMs);
  };

  async function step(): Promise<void> {
    if (stopped || doc.hidden) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    again = false;
    let more = false;
    waitingForEngine = false;
    const ac = new AbortController();
    current = ac;
    try {
      const st = await engine.status();
      if (stopped || doc.hidden || ac.signal.aborted) return;
      if (st.state !== "ready" || st.paused || !canRead()) {
        waitingForEngine = true;
        schedule(idleMs);
        return;
      }
      const n = await engine.readSome(batch, ac.signal);
      if (stopped || doc.hidden || ac.signal.aborted) return;
      backoff = retryMs;
      // More work: go straight on, without a timer. A hidden window
      // throttles timers (the desktop app reads while hidden).
      if (n > 0) more = true;
      else schedule(idleMs);
    } catch {
      if (!stopped && !doc.hidden && !ac.signal.aborted) retryLater();
    } finally {
      running = false;
      if (current === ac) current = null;
      if ((more || again) && !stopped && !doc.hidden && timer === null) {
        if (more) void Promise.resolve().then(step);
        else schedule(0);
      }
    }
  }

  const onVisibility = () => {
    if (doc.hidden) {
      clear();
      current?.abort();
    } else schedule(0);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  const unsubscribe = engine.subscribe(() => {
    if (waitingForEngine && !running && !stopped && !doc.hidden) schedule(0);
  });
  schedule(0);

  return {
    stop() {
      stopped = true;
      clear();
      current?.abort();
      doc.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    },
    interrupt() {
      if (stopped) return;
      current?.abort();
      retryLater();
    },
  };
}

/** Calls onUnavailable (which aborts the reads in flight) before a PersonasUnavailableError from the reader reaches the engine. */
export function guardReader(reader: FaceReaderPort, onUnavailable: () => void): FaceReaderPort {
  return {
    async read(photo) {
      try {
        return await reader.read(photo);
      } catch (e) {
        if (e instanceof PersonasUnavailableError) onUnavailable();
        throw e;
      }
    },
  };
}

/** The same for a rendition that could not be fetched for a reason that is not the photo's. */
export function guardFiles(files: FileSource, onUnavailable: () => void): FileSource {
  return {
    candidates: (ws) => files.candidates(ws),
    async rendition(file, ver, signal) {
      try {
        return await files.rendition(file, ver, signal);
      } catch (e) {
        if (e instanceof PersonasUnavailableError) onUnavailable();
        throw e;
      }
    },
  };
}

// ---- the foreground's hold on the read lock ------------------------------------

/**
 * The document the foreground read loops watch: hidden while the gate is, and
 * while the foreground does not hold the read lock. The foreground takes the
 * lock while the app is active (or its gate is open, which implies it) and
 * lets it go when the app leaves the front; if a background window holds it
 * when the app comes back, the window is aborted (./background.ts) and the
 * foreground takes the lock as soon as the window lets it go.
 */
export function foregroundReadDoc(gate: ReadGate): LoopDoc & { stop(): void } {
  let active = AppState.currentState === "active";
  let release: (() => void) | null = null;
  let hidden = true;
  let syncing = false;
  let stopped = false;
  const fns = new Set<() => void>();

  const sync = () => {
    if (syncing || stopped) return;
    syncing = true;
    try {
      const wants = active || !gate.hidden;
      if (wants && !release) release = acquireReadLock("foreground");
      else if (!wants && release) {
        const r = release;
        release = null;
        r();
      }
    } finally {
      syncing = false;
    }
    const next = gate.hidden || !release;
    if (next !== hidden) {
      hidden = next;
      for (const fn of [...fns]) fn();
    }
  };

  gate.addEventListener("visibilitychange", sync);
  const offLock = subscribeReadLock(sync);
  const sub = AppState.addEventListener?.("change", (s) => {
    active = s === "active";
    sync();
  });
  sync();

  return {
    get hidden() {
      return hidden;
    },
    addEventListener(_type, fn) {
      fns.add(fn);
    },
    removeEventListener(_type, fn) {
      fns.delete(fn);
    },
    stop() {
      stopped = true;
      gate.removeEventListener("visibilitychange", sync);
      offLock();
      sub?.remove();
      fns.clear();
      const r = release;
      release = null;
      r?.();
    },
  };
}

// ---- engines ----------------------------------------------------------------

interface Hosted {
  engine: PersonasEngine;
  /** Null until this phone's stored pause for the engine is known. */
  loop: ReadLoop | null;
}

const hosted = new Map<string, Hosted>();
const hostListeners = new Set<() => void>();
const workFns = new Set<() => void>();

/** The work this phone could read may have changed: an engine paused or resumed, turned on, unlocked, or every engine forgotten. */
function workChanged(): void {
  for (const fn of [...workFns]) {
    try {
      fn();
    } catch {
      /* a listener's failure is its own */
    }
  }
}

/** Called when the work this phone could read may have changed (not on every photo read). */
export function subscribePersonasWork(fn: () => void): () => void {
  workFns.add(fn);
  return () => {
    workFns.delete(fn);
  };
}
let shared: {
  webview: WebViewReader;
  reader: FaceReaderPort;
  source: MobileFileSource;
  files: FileSource;
  gate: ReadGate;
  doc: LoopDoc & { stop(): void };
  off: (() => void)[];
} | null = null;

const unavailableFns = new Set<() => void>();

/**
 * A reader or network step failed for a reason that is not the photo's: abort
 * every read in flight (the foreground loops', and a background window's
 * through subscribePersonasUnavailable) before the error reaches the engine,
 * so it is not counted against the photo.
 */
function interruptAll(): void {
  for (const h of hosted.values()) h.loop?.interrupt();
  for (const fn of [...unavailableFns]) {
    try {
      fn();
    } catch {
      /* a listener's failure is its own */
    }
  }
}

/** Called (synchronously, before the engine sees the error) when a read fails as unavailable. */
export function subscribePersonasUnavailable(fn: () => void): () => void {
  unavailableFns.add(fn);
  return () => {
    unavailableFns.delete(fn);
  };
}

/** The models are fetched at most once per app session (spec 10: in the foreground, on any network). */
let modelsFetch: "never" | "running" | "tried" = "never";

/** In the foreground with a connection: fetch the native reader's models once, then switch to it. */
function maybeFetchModels(gate: ReadGate): void {
  if (modelsFetch !== "never" || !isNativeFaceReaderAvailable() || personasReaderKind() === "native") return;
  // Not hidden, or held for something other than a connection: in front and connected.
  if (gate.hidden && !gate.held) return;
  modelsFetch = "running";
  ensureFaceModels().then(
    (ok) => {
      modelsFetch = "tried";
      if (ok) markFaceModelsReady();
    },
    () => {
      modelsFetch = "tried";
    },
  );
}

/** The reader switched to native: the WebView's reads in flight end, and its page goes. */
function readerKindChanged(): void {
  if (!shared) return;
  if (personasReaderKind() === "native") {
    interruptAll();
    shared.webview.reset();
    personasReaderChannel.close();
  }
  deviceChanged();
}

function sharedPorts() {
  if (!shared) {
    // One reader, one listing cache and one gate for every workspace.
    const channel = personasReaderChannel;
    const webview = createWebViewReader((m) => channel.post(m), { onStuck: () => channel.remount() });
    channel.connect({ receive: (d) => webview.onMessage(d), gone: () => webview.reset(), unloaded: () => webview.unloaded() });
    const webReader = guardReader(webview, interruptAll);
    let nativeReader: FaceReaderPort | null = null;
    const native = () => (nativeReader ??= guardReader(personasNativeReader(), interruptAll));
    const source = mobileFileSource();
    const gate = appReadGate();
    const doc = foregroundReadDoc(gate);
    shared = {
      webview,
      // Chosen per photo: the native reader once it is ready, otherwise the WebView.
      reader: { read: (photo) => (personasReaderKind() === "native" ? native() : webReader).read(photo) },
      source,
      files: guardFiles(source, interruptAll),
      gate,
      doc,
      off: [
        webview.onSupported(deviceChanged),
        gate.subscribe(deviceChanged),
        gate.subscribe(() => maybeFetchModels(gate)),
        subscribeReaderKind(readerKindChanged),
      ],
    };
    void refreshReaderKind();
    maybeFetchModels(gate);
  }
  return shared;
}

/** Whether the read loops can read now: the native reader always can; the WebView unless it said it cannot. */
const canReadNow = () => personasReaderKind() === "native" || shared?.webview.supported() !== false;

/** The phone's read gate, shared with the background windows (./background.ts). */
export function personasReadGate(): ReadGate {
  return sharedPorts().gate;
}

/** Let the native reader's models go once its reads settle (a background window's end). */
export function unloadPersonasReader(): Promise<void> {
  return unloadPersonasNativeReader();
}

/** Where memory warnings come from; each lets the native reader's models go. */
export const watchPersonasMemoryWarnings = setPersonasMemoryWarnings;

// The native event (iOS didReceiveMemoryWarning, Android onTrimMemory >= RUNNING_LOW), in the foreground too.
watchPersonasMemoryWarnings(onMemoryWarning);

const DEVICE_KEY = "dosya.personas.device";

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random id for this phone, written into the records it journals; kept in the keychain once it can be. */
let device = randomHex(16);
let deviceLoaded = false;
function deviceId(): string {
  if (!deviceLoaded) {
    deviceLoaded = true;
    const made = device;
    getItem(DEVICE_KEY).then(
      (have) => {
        if (have && /^[0-9a-f]{32}$/.test(have)) device = have;
        else void setItem(DEVICE_KEY, made).catch(() => undefined);
      },
      () => undefined,
    );
  }
  return device;
}

/** "Read on this device" off, per user and workspace, kept in this phone's keychain (secure-store key characters only). */
const pausedKey = (userId: string, workspaceId: string) =>
  `dosya.personas.paused.${userId}.${workspaceId}`.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Remember every setPaused in the keychain, and apply the stored choice once
 * it is read (an unreadable keychain reads as not paused). A choice the user
 * makes before the keychain answers wins. Resolves when the stored choice is
 * known.
 */
function rememberPause(engine: PersonasEngine, userId: string, workspaceId: string): Promise<void> {
  const key = pausedKey(userId, workspaceId);
  const set = engine.setPaused.bind(engine);
  let touched = false;
  engine.setPaused = (p: boolean) => {
    touched = true;
    set(p);
    workChanged();
    (p ? setItem(key, "1") : deleteItem(key)).catch(() => { /* kept in memory for this session */ });
  };
  return getItem(key).then(
    (v) => {
      if (!touched && v === "1") set(true);
    },
    () => undefined,
  );
}

/**
 * Whether the user has a Vault identity, decided the way the Vault screen
 * decides "set up" versus "unlock" (checked once if unknown). Throws when
 * that cannot be known, so a network blip never shows setup to someone who
 * has an identity.
 */
async function hasVaultIdentity(): Promise<boolean> {
  const known = useVault.getState().hasIdentity;
  if (known !== null) return known;
  await useVault.getState().checkIdentity();
  const h = useVault.getState().hasIdentity;
  if (h === null) throw new Error("personas: could not check for a Vault identity");
  return h;
}

// A sign-out teardown holds until the user changes, so nothing re-creates an
// engine on the way out (./teardown).
function signedInUser(): string {
  const id = personasUser();
  if (!id || personasTornDown()) throw new Error("personas: not signed in");
  return id;
}

/**
 * The engine for this user and workspace, made once per app session. Reading
 * starts once this phone's stored pause for it is read from the keychain,
 * while the read gate is open and the engine is ready and not paused.
 */
export function personasEngine(workspaceId: string): PersonasEngine {
  return engineFor(signedInUser(), workspaceId);
}

function engineFor(userId: string, workspaceId: string): PersonasEngine {
  const key = `${userId}:${workspaceId}`;
  const have = hosted.get(key);
  if (have) return have.engine;
  const { reader, files, doc } = sharedPorts();
  const engine = new PersonasEngine({
    api: mobileJournalApi(),
    cache: sqliteLocalCache(),
    keys: secureKeyStore(),
    reader,
    files,
    userId,
    workspaceId,
    deviceId: deviceId(),
    hasIdentity: hasVaultIdentity,
    readAhead: MOBILE_READ_AHEAD,
  });
  const h: Hosted = { engine, loop: null };
  hosted.set(key, h);
  const turnOn = engine.turnOn.bind(engine);
  engine.turnOn = async () => {
    await turnOn();
    workChanged();
  };
  // "Turn off and delete" (turnOff calls deleteIndex): nothing is left to
  // read, so the schedule syncs again and the Android service stops. Also
  // when it fails part-way: the plan is made from what is there now.
  const deleteIndex = engine.deleteIndex.bind(engine);
  engine.deleteIndex = async () => {
    try {
      await deleteIndex();
    } finally {
      workChanged();
    }
  };
  void rememberPause(engine, userId, workspaceId).then(() => {
    if (hosted.get(key) !== h) return; // torn down meanwhile
    h.loop = runReadLoop(engine, { doc, canRead: canReadNow });
  });
  return engine;
}

/**
 * The file rows of the photos Personas may read in the workspace, by id, from
 * the listing the engine reads from (cached for five minutes, shared with
 * it). The persona screen names and opens its photos from these.
 */
export function personasPhotoRows(workspaceId: string): Promise<ReadonlyMap<string, PhotoRow>> {
  try {
    signedInUser();
  } catch (e) {
    return Promise.reject(e);
  }
  return sharedPorts().source.photos(workspaceId);
}

export type { PhotoRow };


/**
 * Hand the unlocked Vault identity to the engine: opens the user's personas
 * key, or creates and seals it if there is none, and caches it on this phone.
 * Call right after a Vault unlock or setup.
 */
export async function unlockPersonas(workspaceId: string): Promise<void> {
  const userId = signedInUser();
  const id = vaultPersonasIdentity();
  if (!id) throw new Error("personas: the Vault is locked");
  try {
    await personasEngine(workspaceId).unlockWith({ userId, x25519Pub: id.x25519Pub, x25519Priv: id.x25519Priv });
  } finally {
    id.x25519Priv.fill(0);
  }
  for (const fn of [...hostListeners]) fn();
  workChanged();
}

/**
 * The Android notification's Pause (spec 10): the per-device pause, kept in
 * the keychain, on every engine this process hosts (a background window makes
 * one for each workspace it reads). Resume is the per-workspace switch.
 */
export function pausePersonasEngines(): void {
  for (const h of hosted.values()) {
    try {
      h.engine.setPaused(true);
    } catch {
      /* the others still pause */
    }
  }
}

/** Stop every read loop, forget every engine, the listing cache and the gate, and let the reader WebView go (sign-out). */
export function stopPersonasEngines(): void {
  for (const h of hosted.values()) h.loop?.stop();
  hosted.clear();
  if (shared) {
    for (const off of shared.off) off();
    shared.webview.dispose();
    shared.doc.stop();
    shared.gate.stop();
    personasReaderChannel.connect(null);
  }
  personasReaderChannel.close();
  shared = null;
  deviceChanged();
  for (const fn of [...hostListeners]) fn();
  workChanged();
}

// ---- this phone's reading, for the screens ----------------------------------

export interface PersonasDeviceState {
  /** False once this phone's WebView said it cannot run the reader (and the native reader is not in use). */
  supported: boolean;
  /**
   * Connected, but reading waits: for Wi-Fi ("Use mobile data" is off), a
   * charger ("While charging" / "Only while dosya is open"), battery at 20% or
   * more or Low Power Mode / Battery Saver off ("Any time"), or a cooler phone
   * (thermal serious or worse, in every mode).
   */
  held: boolean;
  /** What it waits for (the gate's heldReason), null when not held. */
  heldReason: HeldReason | null;
}

const deviceFns = new Set<() => void>();
let deviceState: PersonasDeviceState = { supported: true, held: false, heldReason: null };

function deviceChanged(): void {
  const held = shared?.gate.held ?? false;
  const next = { supported: shared ? canReadNow() : true, held, heldReason: held ? (shared?.gate.heldReason ?? null) : null };
  if (next.supported === deviceState.supported && next.held === deviceState.held && next.heldReason === deviceState.heldReason) return;
  deviceState = next;
  for (const fn of [...deviceFns]) fn();
  // A phone that just learned it cannot read: the screens re-read the status.
  for (const fn of [...hostListeners]) fn();
}

export function personasDeviceState(): PersonasDeviceState {
  return deviceState;
}

export function subscribePersonasDevice(fn: () => void): () => void {
  deviceFns.add(fn);
  return () => {
    deviceFns.delete(fn);
  };
}

/** Whether this phone can read photos, and what reading waits for (Wi-Fi, a charger, battery, Low Power Mode, heat). */
export function usePersonasDevice(): PersonasDeviceState {
  return useSyncExternalStore(subscribePersonasDevice, personasDeviceState, personasDeviceState);
}

onPersonasTeardown(stopPersonasEngines);

export interface PersonasEngineState {
  /** Null while signed out. */
  engine: PersonasEngine | null;
  /** Null until the first status() answers (and while signed out). */
  status: EngineStatus | null;
  /** The last status() failure (offline with nothing cached); cleared by the next answer. */
  error: unknown;
  refresh: () => void;
}

/** The workspace's engine and its status, re-read whenever the engine (or a Personas unlock) reports a change. */
export function usePersonasEngine(workspaceId: string): PersonasEngineState {
  const userId = useSyncExternalStore(subscribePersonasUser, personasUser, personasUser);
  const [epoch, setEpoch] = useState(0);
  // `epoch` makes a new engine after a sign-out teardown forgot the old one.
  const engine = useMemo(
    () => (userId && workspaceId && epoch >= 0 && !personasTornDown() ? engineFor(userId, workspaceId) : null),
    [workspaceId, userId, epoch],
  );
  const [state, setState] = useState<{ engine: PersonasEngine | null; status: EngineStatus | null; error: unknown }>({ engine, status: null, error: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const onHost = () => {
      if ((engine && !isHosted(engine)) || (!engine && !personasTornDown())) setEpoch((n) => n + 1);
      refresh();
    };
    const unsubscribe = engine ? engine.subscribe(refresh) : () => undefined;
    hostListeners.add(onHost);
    return () => {
      unsubscribe();
      hostListeners.delete(onHost);
    };
  }, [engine, refresh]);

  useEffect(() => {
    if (!engine) return;
    let alive = true;
    engine.status().then(
      (status) => alive && setState({ engine, status, error: null }),
      (error) => alive && setState((s) => ({ engine, status: s.engine === engine ? s.status : null, error })),
    );
    return () => {
      alive = false;
    };
  }, [engine, tick]);

  const current = state.engine === engine ? state : { engine, status: null, error: null };
  return { engine, status: current.status, error: current.error, refresh };
}

function isHosted(engine: PersonasEngine): boolean {
  for (const h of hosted.values()) if (h.engine === engine) return true;
  return false;
}

export { personasReaderKind } from "./reader-kind";
