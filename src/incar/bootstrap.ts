import { ensureI18n } from "@/lib/i18n";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaceStore } from "@/files/workspaceStore";

/**
 * Cold-launch entry point for the CarPlay scene: restore the session from
 * SecureStore exactly like a normal app launch does, before any incar API
 * call. `authStore.hydrate()` never throws — an unreadable/absent store
 * resolves to a "signedOut" state rather than rejecting. The workspace store
 * (apps/mobile/src/files/workspaceStore.ts) hydrates independently — it's
 * its own SecureStore-backed record of the last-active workspace, not part
 * of the auth session — so a signed-in CarPlay cold launch needs both, or
 * `activeId` reads as null even for a user who has an active workspace.
 */
export async function hydrateForCarPlay(): Promise<"signed-in" | "signed-out"> {
  // The CarPlay scene can launch with no React tree; its templates need the language first.
  await ensureI18n();
  await useAuthStore.getState().hydrate();
  if (useAuthStore.getState().status !== "signedIn") return "signed-out";
  const ws = useWorkspaceStore.getState();
  if (!ws.hydrated) await ws.hydrate();
  return "signed-in";
}
