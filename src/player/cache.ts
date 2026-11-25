import * as FileSystem from "expo-file-system/legacy";
import type { PlayerTrack } from "./types";

export interface CacheEntry {
  fileId: string;
  extension: string | null;
  sizeBytes: number;
  modifiedAt: number;
  lastPlayedAt: number;
}

export const CACHE_CAP_BYTES = 500 * 1024 * 1024;
const MAX_CONSECUTIVE_FAILURES = 3;

const DIR = `${FileSystem.cacheDirectory}audio-cache/`;
const INDEX = `${DIR}index.json`;

let failures = 0;
const inFlight = new Map<string, ReturnType<typeof FileSystem.createDownloadResumable> | null>();

let onTrackCached: ((t: PlayerTrack, uri: string) => void) | null = null;
/** Post-cache hook (metadata extraction). Callback must not throw. */
export function setOnTrackCached(cb: ((t: PlayerTrack, uri: string) => void) | null): void {
  onTrackCached = cb;
}

/** Pure LRU pick: which fileIds to drop so the total stays within the cap. */
export function selectEvictions(entries: CacheEntry[], capBytes: number): string[] {
  let total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const oldestFirst = [...entries].sort((a, b) => a.lastPlayedAt - b.lastPlayedAt);
  const evict: string[] = [];
  for (const e of oldestFirst) {
    if (total <= capBytes) break;
    evict.push(e.fileId);
    total -= e.sizeBytes;
  }
  return evict;
}

function trackPath(fileId: string, extension: string | null): string {
  return `${DIR}${fileId}.${(extension || "bin").replace(/[^a-zA-Z0-9]/g, "")}`;
}

async function readIndex(): Promise<CacheEntry[]> {
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(INDEX));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: CacheEntry[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(entries));
}

/** file:// uri when cached AND still current (size + modified match), else null. */
export async function getCachedUri(t: PlayerTrack): Promise<string | null> {
  const entries = await readIndex();
  const entry = entries.find((e) => e.fileId === t.fileId);
  if (!entry) return null;
  const path = trackPath(entry.fileId, entry.extension);
  const stale = entry.sizeBytes !== t.sizeBytes || entry.modifiedAt !== t.modifiedAt;
  const info = await FileSystem.getInfoAsync(path);
  if (stale || !info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    await writeIndex(entries.filter((e) => e.fileId !== t.fileId)).catch(() => {});
    return null;
  }
  return path;
}

export async function cacheTrack(t: PlayerTrack, url: string): Promise<void> {
  if (failures >= MAX_CONSECUTIVE_FAILURES) return; // cache stood down for this session
  if (inFlight.has(t.fileId)) return;
  // Reserve the key immediately to prevent concurrent downloads of the same fileId.
  inFlight.set(t.fileId, null);
  try {
    if (await getCachedUri(t)) {
      inFlight.delete(t.fileId);
      return;
    }
    const path = trackPath(t.fileId, t.extension);
    const dl = FileSystem.createDownloadResumable(url, path);
    inFlight.set(t.fileId, dl);
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const res = await dl.downloadAsync();
    if (!res) return; // cancelled mid-flight
    if (res.status >= 400) {
      // Expired/denied presign - downloadAsync wrote the JSON error body to disk.
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      return;
    }
    const entries = (await readIndex()).filter((e) => e.fileId !== t.fileId);
    entries.push({ fileId: t.fileId, extension: t.extension, sizeBytes: t.sizeBytes, modifiedAt: t.modifiedAt, lastPlayedAt: Date.now() });
    const evict = selectEvictions(entries, CACHE_CAP_BYTES);
    for (const id of evict) {
      const gone = entries.find((e) => e.fileId === id);
      if (gone) await FileSystem.deleteAsync(trackPath(gone.fileId, gone.extension), { idempotent: true }).catch(() => {});
    }
    await writeIndex(entries.filter((e) => !evict.includes(e.fileId)));
    onTrackCached?.(t, path);
    failures = 0;
  } catch {
    failures += 1; // disk-full and similar; streaming playback is unaffected
  } finally {
    inFlight.delete(t.fileId);
  }
}

/** Cancel in-flight fills that fell out of the play window (active + next). */
export function cancelCachingExcept(keep: Set<string>): void {
  for (const [fileId, dl] of inFlight) {
    if (!keep.has(fileId)) {
      if (dl) void dl.cancelAsync().catch(() => {});
      inFlight.delete(fileId);
    }
  }
}

export async function markPlayed(fileId: string): Promise<void> {
  const entries = await readIndex();
  const entry = entries.find((e) => e.fileId === fileId);
  if (!entry) return;
  entry.lastPlayedAt = Date.now();
  await writeIndex(entries).catch(() => {});
}

export function _resetForTests(): void {
  failures = 0;
  inFlight.clear();
}
