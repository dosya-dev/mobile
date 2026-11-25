import * as Crypto from "expo-crypto";
import { getItem, setItem } from "@/lib/keychain";

/**
 * A stable identity for THIS INSTALLATION of the mobile app.
 *
 * Same contract as the desktop app (apps/desktop/src/main/sync/device-id.ts)
 * and the CLI (apps/cli/src/device-id.ts): one random id per installation, sent
 * on the `X-Dosya-Device` header, treated as opaque by the server.
 *
 *   - **Random, never derived from hardware.** An IDFV, an Android id or a
 *     serial would be a fingerprint that survives an uninstall and identifies
 *     the person rather than the installation. This means nothing outside our
 *     own tables.
 *   - **One per installation, not one per account.** `purgeAccountData` clears
 *     account data on sign-out key by key and deliberately leaves device-level
 *     state alone - this belongs with the biometric preference and the theme,
 *     not with the tokens. Migration 0113 keys `device_sync_state` on
 *     `(user_id, device_id)`, so two accounts on one handset are already
 *     separated server-side.
 *
 * **What it is NOT used for here.** This app has no sync path: nothing in
 * apps/mobile reaches `POST /api/sync/commit`, so mobile never writes
 * `device_sync_state` and the sync watchdog never sees a phone. The id exists
 * for spec §5.9's `backup_failed`, whose dedupe key is `{deviceId}` and whose
 * copy names the device the backup paused on - see `src/backup/alerts.ts`.
 *
 * A reinstall produces a new id. That is fine: `backup_failed` dedupes per
 * device, so the worst case is one extra notification after a reinstall.
 */

/** The header the server reads (`apps/api/src/lib/sync/device-state.ts`). */
export const DEVICE_ID_HEADER = "X-Dosya-Device";

const KEY = "dosya.device.id";

/**
 * The same shape and bounds the server validates on (`parseDeviceId`). Kept in
 * step deliberately: an id this app happily persists but the server silently
 * ignores is a device that looks like it is reporting and never is.
 */
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const SHAPE = /^[A-Za-z0-9._:-]+$/;

export function isValidDeviceId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim();
  return id.length >= MIN_LENGTH && id.length <= MAX_LENGTH && SHAPE.test(id);
}

/**
 * A UUID, from whichever generator this runtime actually has.
 *
 * `Crypto.randomUUID` is the intended one. The fallbacks exist because this
 * function must not throw: it is the last thing standing between a missing
 * native module and an app that cannot mint an id at all, and an id that
 * never gets minted is worse than one from a weaker generator - nothing here
 * is a secret or a capability, it is a key in our own table.
 */
function mint(): string {
  try {
    const uuid = Crypto.randomUUID();
    if (isValidDeviceId(uuid)) return uuid;
  } catch {
    /* fall through */
  }
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (isValidDeviceId(uuid)) return uuid;
  } catch {
    /* fall through */
  }
  // Last resort, and deliberately still 32 hex characters wide so it cannot
  // collide with another installation in any practical population.
  let out = "";
  while (out.length < 32) out += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return out.slice(0, 32);
}

let resolved: string | null = null;
let inFlight: Promise<string> | null = null;

/**
 * Read the installation's id, minting and persisting one on first call.
 *
 * **Never throws and never returns an empty string.** A store that cannot be
 * read or written yields an in-memory id, so the app reports consistently for
 * as long as it is running and simply starts over next launch - the same
 * degradation as a reinstall.
 *
 * Concurrent callers share the one in-flight promise, so two requests racing at
 * startup cannot mint two ids and have the loser overwrite the store.
 */
export function ensureDeviceId(): Promise<string> {
  if (resolved) return Promise.resolve(resolved);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const stored = await getItem(KEY);
        if (isValidDeviceId(stored)) return stored.trim();
      } catch {
        /* store unreadable - mint below */
      }
      const id = mint();
      try {
        await setItem(KEY, id);
      } catch {
        /* not persisted - this id lasts for the life of the process */
      }
      return id;
    })()
      .then((id) => {
        resolved = id;
        return id;
      })
      .catch(() => {
        // Belt and braces: nothing above can reject, and if something ever
        // does, an id still comes back rather than a rejected promise reaching
        // a caller that only wanted to decorate a header.
        const id = mint();
        resolved = id;
        return id;
      });
  }
  return inFlight;
}

/**
 * The id if it has already been loaded, otherwise null.
 *
 * For `apiRequest`, which builds its headers synchronously. `ensureDeviceId` is
 * kicked off at app start (app/_layout.tsx), so in practice this is only null
 * for the first request or two of a cold launch - and the one caller that
 * genuinely needs the header awaits `ensureDeviceId()` first.
 */
export function currentDeviceId(): string | null {
  return resolved;
}

/** Test hook: forget everything so a spec can simulate a fresh install. */
export function __resetDeviceId(): void {
  resolved = null;
  inFlight = null;
}
