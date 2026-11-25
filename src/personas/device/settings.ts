// Personas read settings: when this phone reads photos (open / charging /
// anytime) and whether it may use mobile data. A choice for this phone, not the
// account: kept in the keychain, read into memory once, and dropped at sign-out
// so the next account on the phone starts from the default (charging, Wi-Fi only).
// Also here: whether the Android notification permission has been asked for
// (once, when the user first picks a background mode), reset with the rest.
import { useEffect, useSyncExternalStore } from "react";
import { deleteItem, getItem, setItem } from "@/lib/keychain";

export type ReadMode = "open" | "charging" | "anytime";
export interface ReadSettings { mode: ReadMode; mobileData: boolean }

export const READ_MODE_KEY = "dosya.personas.read-mode";
export const MOBILE_DATA_KEY = "dosya.personas.mobile-data";
/** "1" once the notification permission was asked for on choosing a background mode (Android). */
export const NOTIFICATIONS_ASKED_KEY = "dosya.personas.notifications-asked";
/** The single "read anywhere" switch this replaced; migrated once, then deleted. */
const LEGACY_READ_ANYWHERE_KEY = "dosya.personas.read-anywhere";

const DEFAULTS: ReadSettings = { mode: "charging", mobileData: false };
const MODES: readonly ReadMode[] = ["open", "charging", "anytime"];

let value: ReadSettings = DEFAULTS;
let loading: Promise<ReadSettings> | null = null;
/** Bumped by every reset, so a load that lands later does not resurrect old values. */
let version = 0;
/** Fields set since the last reset: a load that lands later does not overwrite them. */
const touched = new Set<keyof ReadSettings>();
const listeners = new Set<() => void>();
/** Asked (or asking) since the last reset: a second quick choice does not ask again. */
let notificationsAsked = false;

const announce = () => {
  for (const fn of [...listeners]) fn();
};

const asMode = (v: string | null): ReadMode => (MODES.includes(v as ReadMode) ? (v as ReadMode) : "charging");
const swallow = () => { /* kept in memory for this session */ };

export function readSettings(): ReadSettings {
  return value;
}

/** The stored settings, read once (an unreadable keychain reads as the defaults). */
export function loadReadSettings(): Promise<ReadSettings> {
  if (loading) return loading;
  const at = version;
  loading = (async () => {
    let mode = await getItem(READ_MODE_KEY);
    let data = await getItem(MOBILE_DATA_KEY);
    if (mode === null && data === null) {
      const legacy = await getItem(LEGACY_READ_ANYWHERE_KEY);
      if (legacy === "1") {
        mode = "anytime";
        data = "1";
        // Only while this load is still current, and never over a value the user has set since.
        if (at === version) {
          await Promise.all([
            touched.has("mode") ? undefined : setItem(READ_MODE_KEY, "anytime"),
            touched.has("mobileData") ? undefined : setItem(MOBILE_DATA_KEY, "1"),
          ]);
        }
      }
      if (legacy !== null) await deleteItem(LEGACY_READ_ANYWHERE_KEY);
    }
    if (at !== version) return value;
    const next: ReadSettings = {
      mode: touched.has("mode") ? value.mode : asMode(mode),
      mobileData: touched.has("mobileData") ? value.mobileData : data === "1",
    };
    if (next.mode !== value.mode || next.mobileData !== value.mobileData) {
      value = next;
      announce();
    }
    return value;
  })().catch(() => value);
  return loading;
}

export function setReadMode(m: ReadMode): void {
  touched.add("mode");
  setItem(READ_MODE_KEY, m).catch(swallow);
  if (m === value.mode) return;
  value = { ...value, mode: m };
  announce();
}

export function setMobileData(on: boolean): void {
  touched.add("mobileData");
  setItem(MOBILE_DATA_KEY, on ? "1" : "0").catch(swallow);
  if (on === value.mobileData) return;
  value = { ...value, mobileData: on };
  announce();
}

export function subscribeReadSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Sign-out: back to charging and Wi-Fi only. */
export async function resetReadSettings(): Promise<void> {
  version++;
  loading = null;
  touched.clear();
  notificationsAsked = false;
  const changed = value.mode !== DEFAULTS.mode || value.mobileData !== DEFAULTS.mobileData;
  value = DEFAULTS;
  await Promise.all([READ_MODE_KEY, MOBILE_DATA_KEY, LEGACY_READ_ANYWHERE_KEY, NOTIFICATIONS_ASKED_KEY].map((k) => deleteItem(k).catch(() => undefined)));
  if (changed) announce();
}

/**
 * Android: ask for the notification permission (`ask`) the first time the
 * user picks "While charging" or "Any time", never again until sign-out.
 * True when it asked now. An unreadable keychain counts as not asked yet.
 */
export async function askNotificationsOnce(ask: () => Promise<boolean>): Promise<boolean> {
  if (notificationsAsked) return false;
  notificationsAsked = true;
  const at = version;
  const stored = await getItem(NOTIFICATIONS_ASKED_KEY).catch(() => null);
  if (stored === "1" || at !== version) return false;
  await setItem(NOTIFICATIONS_ASKED_KEY, "1").catch(swallow);
  await ask().catch(() => false);
  return true;
}

export function useReadSettings(): ReadSettings {
  useEffect(() => { void loadReadSettings(); }, []);
  return useSyncExternalStore(subscribeReadSettings, readSettings, readSettings);
}
