import { getDownloadUrl } from "@/files/api";
import type { FileItem } from "@/files/types";
import { pauseIfPlaying } from "@/player/controller";
import { STREAM_URL_TTL_SECONDS } from "@/viewer/useFilePreview";
import { castContentType, castKind } from "./castSupport";
import { useCastStore } from "./castStore";
import { googleCast } from "./native";

/**
 * Sending files to a Chromecast.
 *
 * The TV fetches the file itself, from a presigned URL, through Google's
 * Default Media Receiver: nothing streams through the phone, and the phone can
 * lock or leave the viewer while the TV plays on.
 *
 * The one thing that cannot be left to the TV is the URL's lifetime. A
 * presign lives an hour at most (download-ttl.ts caps it), and the receiver
 * issues Range requests for as long as the film runs, so a two-hour video
 * would 403 at the hour mark - the same failure the phone's own player had
 * (useFilePreview's STREAM_URL_TTL_SECONDS). Before the link runs out, the
 * same file is loaded again with a fresh one at the position it had reached.
 */

type CastFile = Pick<FileItem, "id" | "name" | "mime_type" | "extension">;

/** Re-presign this long before the link would expire. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let wired = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** What the TV was last handed, so a refresh can hand it the same again. */
let loaded: { file: CastFile; unlockToken: string | null } | null = null;

function clearRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

/**
 * Follows the SDK's session into the store. Runs once, on first use: a
 * session can outlive the viewer that started it, and one resumed by the SDK
 * after the app restarts has to show up as connected too.
 */
export function initCast(): boolean {
  const gc = googleCast();
  if (!gc) return false;
  if (wired) return true;
  wired = true;
  const { sessionManager } = gc.CastContext;
  const store = useCastStore.getState();
  const named = (session: { getCastDevice(): Promise<{ friendlyName: string } | null> }) =>
    session.getCastDevice().then((d) => d?.friendlyName ?? null).catch(() => null);

  sessionManager.onSessionStarting(() => store.setStatus("connecting"));
  sessionManager.onSessionResuming(() => store.setStatus("connecting"));
  sessionManager.onSessionStarted((s) => void named(s).then((n) => store.setStatus("connected", n)));
  sessionManager.onSessionResumed((s) => void named(s).then((n) => store.setStatus("connected", n)));
  sessionManager.onSessionStartFailed(() => store.setStatus("idle"));
  sessionManager.onSessionEnded(() => {
    clearRefresh();
    loaded = null;
    store.setStatus("idle");
  });
  void sessionManager.getCurrentCastSession().then((s) => {
    if (s) void named(s).then((n) => store.setStatus("connected", n));
  }).catch(() => {});
  return true;
}

/** Whether this binary carries the Cast SDK (and, on Android, Play services). */
export async function castAvailable(): Promise<boolean> {
  const gc = googleCast();
  if (!gc) return false;
  // A phone without Google Play services (Huawei, de-Googled ROMs) has the
  // SDK linked but no framework behind it. iOS answers null here.
  const play = await gc.CastContext.getPlayServicesState().catch(() => null);
  return play == null || play === "success";
}

/** Connects to a TV the device sheet found. Resolves once the SDK has been asked. */
export async function connectTo(deviceId: string): Promise<boolean> {
  const gc = googleCast();
  if (!gc || !initCast()) return false;
  useCastStore.getState().setStatus("connecting");
  const ok = await gc.CastContext.sessionManager.startSession(deviceId).catch(() => false);
  if (!ok) useCastStore.getState().setStatus("idle");
  return ok;
}

/** Waits for the session the device sheet asked for, up to a timeout. */
export function whenConnected(timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const now = useCastStore.getState().status;
    if (now === "connected") return resolve(true);
    if (now === "idle") return resolve(false);
    const timer = setTimeout(() => { unsub(); resolve(false); }, timeoutMs);
    const unsub = useCastStore.subscribe((s) => {
      if (s.status === "connecting") return;
      clearTimeout(timer);
      unsub();
      resolve(s.status === "connected");
    });
  });
}

/**
 * Puts a file on the TV. Throws when the SDK refuses the load; the caller
 * says so on the phone, since nothing on the TV will.
 */
export async function castFile(file: CastFile, unlockToken: string | null, startTime = 0): Promise<void> {
  const gc = googleCast();
  const kind = castKind(file);
  if (!gc || !kind) throw new Error("not castable");
  const session = await gc.CastContext.sessionManager.getCurrentCastSession();
  if (!session) throw new Error("no session");

  // A photo is fetched once, so it gets the server's default lifetime; only
  // something the TV plays needs the long one.
  const streamed = kind !== "image";
  const url = await getDownloadUrl(file.id, unlockToken ?? undefined, streamed ? STREAM_URL_TTL_SECONDS : undefined);
  const issuedAt = Date.now();

  // The same file playing twice, once in the room and once in a pocket.
  if (streamed) void pauseIfPlaying();

  const metadata =
    kind === "video" ? { type: "movie" as const, title: file.name }
    : kind === "audio" ? { type: "musicTrack" as const, title: file.name }
    : { type: "photo" as const, title: file.name };

  await session.getClient().loadMedia({
    autoplay: true,
    startTime,
    mediaInfo: { contentUrl: url, contentType: castContentType(file), metadata },
  });

  loaded = { file, unlockToken };
  useCastStore.getState().setFile(file.id);
  clearRefresh();
  if (streamed) {
    const delay = Math.max(60_000, STREAM_URL_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS - (Date.now() - issuedAt));
    refreshTimer = setTimeout(() => void refreshLink(file.id), delay);
  }
}

/**
 * Reloads what is playing with a fresh link before the old one expires.
 * Skipped when the TV has moved on (another file, or stopped): a stale timer
 * must never put back something the user already replaced.
 */
async function refreshLink(fileId: string): Promise<void> {
  refreshTimer = null;
  const gc = googleCast();
  if (!gc || !loaded || loaded.file.id !== fileId) return;
  try {
    const session = await gc.CastContext.sessionManager.getCurrentCastSession();
    const status = await session?.getClient().getMediaStatus();
    if (!session || !status || status.playerState === "idle") return;
    const { file, unlockToken } = loaded;
    const wasPaused = status.playerState === "paused";
    await castFile(file, unlockToken, status.streamPosition);
    if (wasPaused) await session.getClient().pause();
  } catch {
    // The TV keeps the old link until it runs out; nothing better to do.
  }
}

/** Ends the session and stops whatever the TV is playing. */
export async function stopCasting(): Promise<void> {
  clearRefresh();
  loaded = null;
  await googleCast()?.CastContext.sessionManager.endCurrentSession(true).catch(() => {});
  useCastStore.getState().setStatus("idle");
}

/** The SDK's full-screen remote: play, pause, seek and volume for the TV. */
export function openCastControls(): void {
  void googleCast()?.CastContext.showExpandedControls().catch(() => {});
}
