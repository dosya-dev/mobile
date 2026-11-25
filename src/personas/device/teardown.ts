// Ported from apps/desktop/src/renderer/lib/personas-device/teardown.ts
// (from the web's) - keep them in step.
//
// Sign-out hook for on-device Personas, kept apart from engine-host so the
// sign-out path (src/auth/purge.ts) and the screens' visibility checks do
// not pull the engine in. engine-host registers its teardown when it loads.
//
// Mobile difference: the signed-in user is the auth store's. A change of
// user (signed out, or another account signed in) tears down what the
// previous user had and lets engines be made again for the new one.
import { useAuthStore } from "@/auth/authStore";
import { personasReaderChannel } from "./channel";

const fns = new Set<() => void>();
let tornDown = false;

type AuthSnapshot = { status: string; user: { id?: string } | null };
const userOf = (s: AuthSnapshot): string | null => (s.status === "signedIn" && typeof s.user?.id === "string" ? s.user.id : null);

let userId: string | null = null;
let lastUserId: string | null = null;
let watching = false;
const userFns = new Set<() => void>();

function watch(): void {
  if (watching) return;
  watching = true;
  userId = userOf(useAuthStore.getState());
  lastUserId = userId;
  useAuthStore.subscribe((s) => {
    const next = userOf(s);
    if (next === userId) return;
    const had = userId;
    userId = next;
    if (next) lastUserId = next;
    if (had !== null) teardownPersonas();
    tornDown = false;
    for (const fn of [...userFns]) fn();
  });
}

/** True from a sign-out teardown until the user changes: no engine may be made meanwhile. */
export function personasTornDown(): boolean {
  return tornDown;
}

export function onPersonasTeardown(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

/** Stop every read loop, the reader WebView and the listing cache (sign-out). */
export function teardownPersonas(): void {
  tornDown = true;
  for (const fn of [...fns]) {
    try {
      fn();
    } catch {
      // best effort: sign-out must go on
    }
  }
  personasReaderChannel.close();
}

/** The last user id seen, kept after sign-out so the purge still knows whose key to remove. */
export function lastPersonasUser(): string | null {
  watch();
  return userId ?? lastUserId;
}

/** The signed-in user's id, or null while signed out. */
export function personasUser(): string | null {
  watch();
  return userId;
}

/** Called after every change of the signed-in user. */
export function subscribePersonasUser(fn: () => void): () => void {
  watch();
  userFns.add(fn);
  return () => {
    userFns.delete(fn);
  };
}
