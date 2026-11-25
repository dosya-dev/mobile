import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { setBiometricEnabled } from "./biometric";

/**
 * The app PIN behind App lock.
 *
 * The PIN is the lock; Face ID / fingerprint is only a faster way past it, and
 * the PIN is what the lock screen falls back to when biometrics fail. So a
 * biometric unlock is only offered once a PIN exists (older installs that
 * turned biometrics on before PINs existed are asked to set one, see
 * AppLockGate).
 *
 * Only a salted SHA-256 of the PIN is stored, in the keychain / keystore. Six
 * digits are a small space, so the hash is not what protects the PIN: the
 * persisted wrong-try counter is, wiping the lock and signing out at
 * MAX_PIN_TRIES. It is persisted so killing the app does not reset it.
 */

export const PIN_LENGTH = 6;
export const MAX_PIN_TRIES = 10;
/** Wrong tries from which the lock screen says how many are left. */
export const WARN_FROM_TRIES = 5;

/** "Lock after" choices, in seconds. 0 = every time the app leaves the foreground. */
export const LOCK_AFTER_OPTIONS = [0, 60, 300, 900, 3600] as const;
export type LockAfter = (typeof LOCK_AFTER_OPTIONS)[number];
export const DEFAULT_LOCK_AFTER: LockAfter = 60;

const PIN_KEY = "dosya.applock.pin";
const AFTER_KEY = "dosya.applock.after";
const FAILS_KEY = "dosya.applock.fails";

/**
 * Settings changes the lock from inside the tree AppLockGate guards, so the
 * gate re-reads its config on every change instead of only at launch.
 */
const listeners = new Set<() => void>();
export function onAppLockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed(): void {
  for (const fn of listeners) fn();
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidPin(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

export async function hasPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_KEY)) !== null;
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("invalid pin");
  const salt = hex(Crypto.getRandomBytes(16));
  await SecureStore.setItemAsync(PIN_KEY, `${salt}:${await hashPin(pin, salt)}`);
  await SecureStore.deleteItemAsync(FAILS_KEY);
  changed();
}

export async function getFailedTries(): Promise<number> {
  const n = Number(await SecureStore.getItemAsync(FAILS_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A passed biometric check proves the owner as well as the PIN does. */
export async function resetFailedTries(): Promise<void> {
  await SecureStore.deleteItemAsync(FAILS_KEY);
}

export type PinCheck =
  | { ok: true }
  /** `triesLeft` 0 means the caller must wipe the lock and sign out. */
  | { ok: false; triesLeft: number };

export async function verifyPin(pin: string): Promise<PinCheck> {
  const stored = await SecureStore.getItemAsync(PIN_KEY);
  if (!stored) return { ok: false, triesLeft: 0 };
  // A kill between counting the last try and the wipe must not leave one more guess.
  if ((await getFailedTries()) >= MAX_PIN_TRIES) return { ok: false, triesLeft: 0 };
  const [salt, hash] = stored.split(":");
  if (isValidPin(pin) && (await hashPin(pin, salt)) === hash) {
    await SecureStore.deleteItemAsync(FAILS_KEY);
    return { ok: true };
  }
  const fails = (await getFailedTries()) + 1;
  await SecureStore.setItemAsync(FAILS_KEY, String(fails));
  return { ok: false, triesLeft: Math.max(0, MAX_PIN_TRIES - fails) };
}

export async function getLockAfter(): Promise<LockAfter> {
  const raw = await SecureStore.getItemAsync(AFTER_KEY);
  const n = Number(raw);
  return raw !== null && (LOCK_AFTER_OPTIONS as readonly number[]).includes(n) ? (n as LockAfter) : DEFAULT_LOCK_AFTER;
}

export async function setLockAfter(seconds: LockAfter): Promise<void> {
  await SecureStore.setItemAsync(AFTER_KEY, String(seconds));
  changed();
}

export async function setBiometricUnlock(on: boolean): Promise<void> {
  await setBiometricEnabled(on);
  changed();
}

/**
 * Turn App lock off entirely: PIN, biometric unlock, timer and the wrong-try
 * count. Used by "Turn off App lock", "Forgot PIN?", the last wrong try and
 * sign-out (a PIN belongs to the person who set it, so the next sign-in on
 * this phone starts without one).
 */
export async function clearAppLock(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(PIN_KEY),
    SecureStore.deleteItemAsync(AFTER_KEY),
    SecureStore.deleteItemAsync(FAILS_KEY),
    setBiometricEnabled(false),
  ]);
  changed();
}
