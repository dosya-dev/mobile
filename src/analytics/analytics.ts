/**
 * Usage analytics for the app: on unless the person turns it off in Settings.
 *
 * The app carries no Google SDK. Events are queued here and posted in small
 * batches to our own API (POST /api/analytics/collect), which forwards the
 * ones in the shared catalogue to Google Analytics and nothing else. What an
 * event may say is fixed by ./events.generated.ts: a name and a few category
 * parameters. No file names, no ids, no search text, no account.
 *
 * The rules this module keeps:
 *
 *   - Usage data is part of what people accept with the terms at sign-up, so
 *     it is on from the first launch; there is no separate question. The
 *     switch in Settings turns it off, and once it is off nothing is queued
 *     and nothing leaves.
 *   - The id that names this install to Google is random, minted on first
 *     launch and deleted when sharing is turned off. It is not the device id the
 *     API sees on other requests (lib/deviceId.ts), which is left off here.
 *   - The request carries no Authorization header: the relay does not need to
 *     know who is asking, so it is not told.
 *   - Failing is silent. Analytics never surfaces an error, never retries a
 *     batch, and never keeps the app awake.
 *
 * The auth store, the upload queue and the screens report through ./wiring.ts
 * and the track* functions; this file imports none of them, so anything may
 * import it.
 */
import { AppState, Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { create } from "zustand";
import { API_BASE_URL } from "@/api/config";
import { getItem, setItem, deleteItem } from "@/lib/keychain";
import { activityFromApi, cleanRelayEvent, screenFromSegments, sizeBand } from "./events.generated";

/** "unknown" is only ever a store that could not be read: silent for this run. */
export type AnalyticsConsent = "granted" | "denied" | "unknown";

const CONSENT_KEY = "dosya.analytics.consent";
const CLIENT_KEY = "dosya.analytics.client";
const COLLECT_PATH = "/api/analytics/collect";
/** The relay takes 25 events a request; a full queue is sent at once. */
const BATCH_SIZE = 25;
/** Events wait this long for company before a batch goes out. */
const FLUSH_DELAY_MS = 15_000;
/** Back in the foreground after this long is a new visit, as on the web. */
const SESSION_GAP_MS = 30 * 60 * 1000;
/** Offline for a while: keep the latest, drop the oldest. */
const QUEUE_LIMIT = 100;

interface ConsentState {
  consent: AnalyticsConsent;
  /** False until the stored choice has been read. */
  hydrated: boolean;
}

export const useAnalyticsConsent = create<ConsentState>(() => ({ consent: "unknown", hydrated: false }));

type Queued = { name: string; params?: Record<string, string | number | boolean>; at: number };

let clientId: string | null = null;
let sessionId: string | null = null;
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let foregroundSince: number | null = null;
let engagedMs = 0;
let backgroundedAt: number | null = null;
let lastScreen: string | null = null;
let now: () => number = () => Date.now();
let locale: () => string | null = () => null;

function granted(): boolean {
  return useAnalyticsConsent.getState().consent === "granted";
}

/** Two runs of digits, the shape Google's own tag mints for a browser. */
function mintClientId(): string {
  const random = Math.floor(Math.random() * 2_147_483_647) + 1;
  return `${random}.${Math.floor(now() / 1000)}`;
}

function startSession(): void {
  sessionId = String(Math.floor(now() / 1000));
  lastScreen = null;
}

function platform(): "ios" | "android" | null {
  // Optional chain: a batch timer that outlives a jest file fires after its
  // modules are torn down, with Platform undefined. Null sends nothing.
  const os = Platform?.OS;
  return os === "ios" || os === "android" ? os : null;
}

function appVersion(): string | null {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
  return version && /^[0-9A-Za-z.+-]{1,24}$/.test(version) ? version : null;
}

/** Reads the stored choice: on unless it was turned off. Never rejects; an unreadable store sends nothing for this run. */
export async function hydrateAnalytics(): Promise<void> {
  let consent: AnalyticsConsent = "unknown";
  let readable = true;
  try {
    consent = (await getItem(CONSENT_KEY)) === "0" ? "denied" : "granted";
    if (consent === "granted") {
      clientId = await getItem(CLIENT_KEY);
      if (!clientId) {
        clientId = mintClientId();
        await setItem(CLIENT_KEY, clientId);
      }
    }
  } catch {
    // A store that cannot be read (a locked phone on a background launch)
    // must not be taken for "never turned off": that would collect from
    // someone who switched it off. Stay silent until the next launch.
    consent = "unknown";
    readable = false;
  }
  useAnalyticsConsent.setState({ consent, hydrated: readable });
  if (consent === "granted") beginForeground();
}

/** The Settings switch. */
export async function setAnalyticsConsent(on: boolean): Promise<void> {
  if (on) {
    if (!clientId) clientId = mintClientId();
    useAnalyticsConsent.setState({ consent: "granted", hydrated: true });
    beginForeground();
    try {
      await setItem(CLIENT_KEY, clientId);
      await setItem(CONSENT_KEY, "1");
    } catch {
      /* on for this run either way */
    }
    return;
  }
  // Withdrawn: what was waiting is dropped, not sent, and the id goes with
  // it, so agreeing again later starts as someone new.
  useAnalyticsConsent.setState({ consent: "denied", hydrated: true });
  queue = [];
  clientId = null;
  sessionId = null;
  lastScreen = null;
  foregroundSince = null;
  engagedMs = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  try {
    await setItem(CONSENT_KEY, "0");
    await deleteItem(CLIENT_KEY);
  } catch {
    /* denied for this run either way */
  }
}

function beginForeground(): void {
  if (AppState.currentState === "background") return; // a headless launch is not a visit
  if (!sessionId) {
    startSession();
    enqueue("app_open");
  }
  if (foregroundSince === null) foregroundSince = now();
}

function enqueue(name: string, params?: Record<string, string | number | boolean>): void {
  if (!granted() || !clientId) return;
  // The same filter the relay applies. Run here too, so what is refused never
  // leaves the phone and a test in this app can see what would be sent.
  const clean = cleanRelayEvent(name, params);
  if (!clean) return;
  if (!sessionId) startSession();
  queue.push({ ...clean, at: now() });
  if (queue.length > QUEUE_LIMIT) queue = queue.slice(queue.length - QUEUE_LIMIT);
  if (queue.length >= BATCH_SIZE) void flushAnalytics();
  else if (!timer) {
    timer = setTimeout(() => { timer = null; void flushAnalytics(); }, FLUSH_DELAY_MS);
    // Node (jest) only: a pending batch never holds the process open. On a
    // phone the handle is a number and there is nothing to call.
    (timer as { unref?: () => void }).unref?.();
  }
}

/** Any catalogue event. Unknown names and parameters are dropped. */
export function track(name: string, params?: Record<string, string | number | boolean>): void {
  enqueue(name, params);
}

/** The screen in front, from the router's own segments (templates, never values). */
export function trackScreen(segments: readonly string[]): void {
  if (!granted()) return;
  const screen = screenFromSegments(segments);
  if (screen === lastScreen) return;
  lastScreen = screen;
  enqueue("page_view", { screen });
}

/** Called by apiRequest after a request succeeds; a no-op for reads. */
export function recordApiActivity(method: string | undefined, path: string): void {
  if (!granted()) return;
  const activity = activityFromApi(method, path);
  // Every upload starts with an init call, and camera backup makes thousands
  // of them. Uploads the person sent are counted once each, when they finish
  // (trackUpload); backup is not counted per file at all.
  if (!activity || activity.name === "upload_start") return;
  enqueue(activity.name, activity.params);
}

/** A finished upload the person started, by size band only. */
export function trackUpload(bytes: number): void {
  enqueue("file_upload", { size_band: sizeBand(bytes) });
}

function takeEngagement(): number {
  const t = now();
  if (foregroundSince !== null) {
    engagedMs += Math.max(0, t - foregroundSince);
    foregroundSince = t;
  }
  const taken = engagedMs;
  engagedMs = 0;
  return taken;
}

/** Sends what is waiting. Resolves when the attempt is over; never rejects. */
export async function flushAnalytics(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  // Callers fire and forget (`void flushAnalytics()`), so nothing here may
  // reject: reading the platform or version can throw once a jest file's
  // modules are torn down, and an unhandled rejection ends the process.
  let os: "ios" | "android" | null;
  let version: string | null;
  try {
    os = platform();
    version = appVersion();
  } catch {
    return;
  }
  if (!granted() || !clientId || !sessionId || !os || !version || queue.length === 0) return;
  const events = queue.slice(0, BATCH_SIZE);
  queue = queue.slice(events.length);
  const body: Record<string, unknown> = {
    consent: true,
    client_id: clientId,
    session_id: sessionId,
    platform: os,
    app_version: version,
    engagement_ms: takeEngagement(),
    events,
  };
  const language = locale();
  if (language) body.locale = language;
  try {
    await fetch(`${API_BASE_URL}${COLLECT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* offline: this batch is gone, by design */
  }
  if (queue.length > 0) void flushAnalytics();
}

/**
 * Follows the app in and out of the foreground: time in front is what counts
 * as engagement, leaving sends what is waiting, and coming back after a long
 * gap starts a new visit. Returns a disposer.
 */
export function startAnalyticsLifecycle(opts: { locale?: () => string | null } = {}): () => void {
  if (opts.locale) locale = opts.locale;
  try {
    const sub = AppState.addEventListener("change", (state) => {
      if (!granted()) return;
      if (state === "active") {
        const away = backgroundedAt === null ? 0 : now() - backgroundedAt;
        backgroundedAt = null;
        if (away >= SESSION_GAP_MS) sessionId = null;
        beginForeground();
      } else if (state === "background") {
        if (foregroundSince !== null) {
          engagedMs += Math.max(0, now() - foregroundSince);
          foregroundSince = null;
        }
        backgroundedAt = now();
        void flushAnalytics();
      }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Test seam. */
export function __resetAnalytics(clock?: () => number): void {
  clientId = null;
  sessionId = null;
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  foregroundSince = null;
  engagedMs = 0;
  backgroundedAt = null;
  lastScreen = null;
  now = clock ?? (() => Date.now());
  locale = () => null;
  useAnalyticsConsent.setState({ consent: "unknown", hydrated: false });
}
