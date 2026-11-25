import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { reportError } from "@/telemetry/sentry";
import { setExcludedFromBackup } from "../../modules/dosya-media-extras";
import { accountRoot, OFFLINE_ROOT, type OfflineSession } from "./session";
import type { OfflineFileRow } from "./types";

/**
 * Pinned bytes on disk: `<root>/files/<fileId>-v<version>[-pdf].<ext>` for what
 * is published, `<root>/tmp/` for downloads still in flight.
 *
 * Not the byte cache (src/files/byteStore.ts). That one is a cache directory the
 * OS may purge and an LRU that evicts on its own; these are files the user asked
 * to keep, so they live in Documents and only leave when a pin, an access check
 * or a sign-out says so. The version is in every name, so a published file is
 * never overwritten in place: a new version lands beside the old one, and the old
 * one is removed only once the new one is the row's saved version.
 */

let dev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

/** Test hook: pretend to be a dev or a release build. */
export function __setDevForTests(v: boolean): void {
  dev = v;
}

const filesDir = (s: OfflineSession) => `${s.root}files/`;
const tmpDir = (s: OfflineSession) => `${s.root}tmp/`;

function safeSegment(v: string): string {
  return v.replace(/[^a-zA-Z0-9_-]/g, "_") || "_";
}

function safeExt(ext: string | null | undefined): string {
  const e = (ext ?? "").toLowerCase().replace(/^\./, "");
  return /^[a-z0-9]{1,8}$/.test(e) ? e : "bin";
}

/** The extension a file's saved bytes carry, from its metadata or its name. */
export function extOf(f: Pick<OfflineFileRow, "extension" | "name">): string {
  const fromMeta = safeExt(f.extension);
  if (fromMeta !== "bin") return fromMeta;
  const m = /\.([a-z0-9]{1,8})$/i.exec(f.name);
  return m ? m[1].toLowerCase() : "bin";
}

export function finalPath(s: OfflineSession, fileId: string, version: number, ext: string, variant?: "pdf"): string {
  return variant === "pdf"
    ? `${filesDir(s)}${safeSegment(fileId)}-v${version}-pdf.pdf`
    : `${filesDir(s)}${safeSegment(fileId)}-v${version}.${safeExt(ext)}`;
}

/**
 * Where a row's saved bytes are: under the extension they were written with
 * (saved_ext), not the file's current name. A rename on the server keeps the
 * version, so the current name can point at a file that was never written.
 */
export function savedPath(
  s: OfflineSession,
  r: Pick<OfflineFileRow, "file_id" | "saved_version" | "extension" | "name"> & { saved_ext?: string | null },
  variant?: "pdf",
): string | null {
  if (r.saved_version == null) return null;
  return finalPath(s, r.file_id, r.saved_version, r.saved_ext ?? extOf(r), variant);
}

let seq = 0;
export function tempPath(s: OfflineSession): string {
  seq += 1;
  return `${tmpDir(s)}${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}.part`;
}

/** A finished download is whole: present, non-empty, and exactly the size the server said. */
export async function verify(path: string, expectedBytes: number | null): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return false;
    const size = typeof info.size === "number" ? info.size : -1;
    return expectedBytes == null ? size > 0 : size === expectedBytes;
  } catch {
    return false;
  }
}

/** Publish a verified temp file. The caller holds withCommit. */
export async function moveIntoPlace(tmp: string, final: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(final.slice(0, final.lastIndexOf("/") + 1), { intermediates: true }).catch(() => {});
  await FileSystem.deleteAsync(final, { idempotent: true }).catch(() => {});
  await FileSystem.moveAsync({ from: tmp, to: final });
}

const NAME = /^(.+)-v(\d+)(-pdf)?\.([a-z0-9]{1,8})$/;

function parseName(name: string): { id: string; version: number; pdf: boolean; ext: string } | null {
  const m = NAME.exec(name);
  return m ? { id: m[1], version: Number(m[2]), pdf: !!m[3], ext: m[4] } : null;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
}

/** Remove a file's published bytes (original and rendition), except `keepVersion` when given. */
export async function removeFileBytes(s: OfflineSession, fileId: string, keepVersion?: number): Promise<void> {
  const id = safeSegment(fileId);
  for (const name of await listDir(filesDir(s))) {
    const p = parseName(name);
    if (!p || p.id !== id) continue;
    if (keepVersion != null && p.version === keepVersion) continue;
    await FileSystem.deleteAsync(`${filesDir(s)}${name}`, { idempotent: true }).catch(() => {});
  }
}

/**
 * Start-of-run cleanup: a run killed mid-download leaves temp files, and one
 * killed between publish and cleanup can leave a superseded version. Anything in
 * files/ that is not some row's saved version or ready rendition goes.
 */
export async function sweep(s: OfflineSession, rows: OfflineFileRow[]): Promise<void> {
  await FileSystem.deleteAsync(tmpDir(s), { idempotent: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(tmpDir(s), { intermediates: true }).catch(() => {});
  const byId = new Map(rows.map((r) => [safeSegment(r.file_id), r]));
  for (const name of await listDir(filesDir(s))) {
    const p = parseName(name);
    const r = p ? byId.get(p.id) : undefined;
    const keep = !!p && !!r && (p.pdf
      ? r.rendition === "ready" && r.rendition_version === p.version
      : r.saved_version === p.version && p.ext === safeExt(r.saved_ext ?? extOf(r)));
    if (!keep) await FileSystem.deleteAsync(`${filesDir(s)}${name}`, { idempotent: true }).catch(() => {});
  }
}

/** Bytes the published files hold. Temp files are headroom, not retained storage. */
export async function bytesRetained(s: OfflineSession): Promise<number> {
  let total = 0;
  for (const name of await listDir(filesDir(s))) {
    try {
      const info = await FileSystem.getInfoAsync(`${filesDir(s)}${name}`);
      if (info.exists && typeof info.size === "number") total += info.size;
    } catch {
      // A file that vanished between listing and stat holds nothing.
    }
  }
  return total;
}

/**
 * Remove every account directory under the offline root except this session's.
 * Only one account is ever signed in, so any other directory is what a purge
 * killed half way (or an app killed mid-switch) left behind.
 */
export async function sweepOrphanRoots(s: OfflineSession): Promise<void> {
  for (const name of await listDir(OFFLINE_ROOT)) {
    const dir = `${OFFLINE_ROOT}${name}/`;
    if (dir === s.root) continue;
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
  }
}

/** Remove every account's offline data. Only for a purge with no account to name and no session running. */
export async function wipeAllAccounts(): Promise<void> {
  for (const name of await listDir(OFFLINE_ROOT)) {
    await FileSystem.deleteAsync(`${OFFLINE_ROOT}${name}/`, { idempotent: true }).catch(() => {});
  }
}

/** Remove everything an account has offline. Its database must be closed first. */
export async function wipeAccount(accountId: string): Promise<void> {
  await FileSystem.deleteAsync(accountRoot(accountId), { idempotent: true }).catch(() => {});
}

/**
 * Create the account's directories and keep the offline root out of device
 * backups. The exclusion is on OFFLINE_ROOT, so every account under it inherits
 * it. Android excludes through its backup rules (plugins/withOfflineBackupRules.js),
 * fixed at build time.
 *
 * An iOS build that cannot set the flag still works, but a pinned folder would
 * then count against the user's iCloud quota - so a release build says so in
 * Sentry rather than shipping that silently. Only a dev build (Expo Go, a dev
 * client without the module rebuilt) may skip it quietly.
 */
export async function ensureRoot(s: OfflineSession): Promise<{ excluded: boolean }> {
  await FileSystem.makeDirectoryAsync(filesDir(s), { intermediates: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(tmpDir(s), { intermediates: true }).catch(() => {});
  if (Platform.OS !== "ios") return { excluded: true };
  const result = await setExcludedFromBackup(OFFLINE_ROOT, true);
  if (result === true) return { excluded: true };
  if (!dev) {
    reportError(new Error(result === null
      ? "offline: backup exclusion unavailable (native module missing)"
      : "offline: backup exclusion refused"), { area: "offline" });
  }
  return { excluded: false };
}
