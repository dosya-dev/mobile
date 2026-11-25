import * as SecureStore from "expo-secure-store";

/**
 * ERROR CONTRACT FOR THIS WHOLE MODULE: nothing exported here ever rejects.
 *
 * Every caller gates a user-visible render or navigation on one of these
 * promises - the value deck's exit, each step's "Continue"/"Skip", the gate
 * that renders the entire signed-in app. A rejection therefore does not
 * degrade a feature, it removes the user's only way forward, and a restart
 * re-reads the same storage and strands them again. This branch shipped that
 * bug three times, so the rule is the module's, not the call site's: reads
 * resolve to a safe default, writes resolve with the state they would have
 * stored, and the worst case is "onboarding re-runs next launch".
 *
 * Consequence for callers: they never need a .catch to stay alive. They may
 * still add one as defense in depth, but it must default the same way as the
 * guard here (see app/_layout.tsx's welcomeSeen), so the two cannot diverge.
 */

/** Pre-redesign device-wide flag. Read once, to migrate upgraders. */
const LEGACY_KEY = "dosya.onboarding.completed";
/** The value deck answers "what is this app", which is asked once per DEVICE. */
const WELCOME_KEY = "dosya.welcome.seen";
const key = (accountId: string) => `dosya.onboarding.v1.${accountId}`;

export interface OnboardingState {
  version: 1;
  /** Unix seconds the user finished setup. Null = never finished. */
  completedAt: number | null;
  /** Unix seconds the user chose "Not now" / "Skip". */
  skippedAt: number | null;
  photoPermission: "granted" | "limited" | "denied" | "unasked";
}

export const EMPTY_ONBOARDING: OnboardingState = {
  version: 1,
  completedAt: null,
  skippedAt: null,
  photoPermission: "unasked",
};

const now = () => Math.floor(Date.now() / 1000);

/**
 * An install that predates the redesign carries only the legacy boolean. It
 * must land on "already completed" - re-running first run for an established
 * user would re-ask for permissions they have already granted.
 *
 * The legacy key is device-wide, not per-account, so it is consumed (deleted)
 * as part of migrating: otherwise every later account on the same device -
 * including a genuinely new one that never used the pre-redesign build -
 * would keep matching it and skip first run too.
 */
async function migrateLegacy(accountId: string): Promise<OnboardingState | null> {
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
  if (legacy !== "1") return null;
  const migrated: OnboardingState = { ...EMPTY_ONBOARDING, completedAt: now() };
  await SecureStore.setItemAsync(key(accountId), JSON.stringify(migrated));
  await SecureStore.deleteItemAsync(LEGACY_KEY);
  return migrated;
}

export async function readOnboarding(accountId: string): Promise<OnboardingState> {
  try {
    const raw = await SecureStore.getItemAsync(key(accountId));
    if (raw) return { ...EMPTY_ONBOARDING, ...(JSON.parse(raw) as Partial<OnboardingState>) };
    // migrateLegacy makes its own SecureStore call (the legacy device-wide
    // flag), which must stay inside this guard too - a throw from either call
    // must land on the empty state, never escape to the gate that renders the
    // whole app.
    return (await migrateLegacy(accountId)) ?? EMPTY_ONBOARDING;
  } catch {
    // Corrupt payload or a SecureStore throw: treat as never-onboarded rather
    // than throwing at a gate that renders the whole app.
    return EMPTY_ONBOARDING;
  }
}

/**
 * Per-account tail of pending mutations, so overlapping ones for the same
 * account serialize instead of racing. Without this, two concurrent writes
 * both read the pre-write state and the one that lands second clobbers the
 * fields the first one just patched - and a purge's delete can land between
 * a write's read and its set, resurrecting the key for a signed-out account.
 *
 * Every mutation in this module goes through here, deletes included. That is
 * the whole point: a queue only one of the two writers uses is not a queue.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function enqueueWrite<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(accountId) ?? Promise.resolve();
  const result = prior.then(task, task);
  // The queued tail must never stay rejected, or every future write for this
  // account would be skipped. Tasks below resolve rather than reject anyway;
  // this stays as the structural guarantee for any future one that doesn't.
  const tail: Promise<unknown> = result.catch(() => {});
  writeQueues.set(accountId, tail);
  // Prune once this is the last queued mutation for the account, so the map
  // does not keep one settled entry per account for the life of the process
  // (a signed-out account's tail is pure garbage). Only the tail that is still
  // current is removed, so a mutation queued in the meantime keeps its chain.
  void tail.then(() => {
    if (writeQueues.get(accountId) === tail) writeQueues.delete(accountId);
  });
  return result;
}

/**
 * Resolves with the state that WAS stored - or, if storage refused, with the
 * state that would have been. See the module's error contract: every caller
 * gates a user-visible transition on this promise ("Not now", "Continue",
 * "Skip for now", the final "Done", the Backup tab's "Finish setup"), so a
 * rejection turns those into permanent no-ops. Losing the write degrades to
 * "onboarding re-runs next launch", which is recoverable; stranding is not.
 */
export async function writeOnboarding(
  accountId: string,
  patch: Partial<OnboardingState>,
): Promise<OnboardingState> {
  return enqueueWrite(accountId, async () => {
    let next: OnboardingState = { ...EMPTY_ONBOARDING, ...patch, version: 1 as const };
    try {
      next = { ...(await readOnboarding(accountId)), ...patch, version: 1 as const };
      await SecureStore.setItemAsync(key(accountId), JSON.stringify(next));
    } catch {
      // Storage refused. `next` is still the merged in-memory state, which is
      // what the caller needs to carry on with.
    }
    return next;
  });
}

export async function clearOnboarding(accountId: string): Promise<void> {
  await enqueueWrite(accountId, async () => {
    try {
      await SecureStore.deleteItemAsync(key(accountId));
    } catch {
      // Sign-out purge is best-effort by design (see auth/purge.ts) and must
      // never reject at a caller that is tearing the session down.
    }
  });
}

/**
 * Test hook: how many accounts still have a queued-mutation tail (see
 * enqueueWrite's prune). Same pattern as backup/settings.ts's
 * __resetBackupSettingsHydration - not used in app code.
 */
export function __writeQueueSize(): number {
  return writeQueues.size;
}

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(WELCOME_KEY)) === "1";
  } catch {
    // A caller (AuthGate) drives a signed-out redirect off this value and
    // withholds that redirect until the promise settles - a rejection here
    // would leave that caller stuck on a dead screen forever, not just show
    // the deck late. Default to "seen": an unreadable flag sends the user to
    // login (reachable, safe) rather than risking the deck for a device that
    // may already have dismissed it. The cost is losing the deck once for a
    // device that hits a transient SecureStore failure at exactly this read.
    return true;
  }
}

export async function setWelcomeSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(WELCOME_KEY, "1");
  } catch {
    // welcome.tsx AWAITS this before router.replace, and the deck was entered
    // by replace, so there is no back: a rejection here leaves a first-time
    // user on the deck with both exits dead, and a restart re-reads the same
    // unwritten flag. Losing the flag only costs showing the deck once more.
  }
}
