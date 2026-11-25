import { useEffect, type ReactNode } from "react";
import { useWorkspaces } from "./hooks";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * Guarantees the signed-in app always has a usable workspace context:
 * - workspaces exist but none is selected (fresh install, or the sign-out
 *   purge cleared the persisted choice) or the selection went stale (left /
 *   deleted workspace) → auto-select the first
 * Without this, every screen quietly renders empty against activeId = null.
 *
 * No workspaces at all is OnboardingFlow's territory (it owns creating the
 * first one). This gate only guarantees that a SELECTION exists among
 * workspaces that already do.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { data: workspaces } = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const setActive = useWorkspaceStore((s) => s.setActive);

  useEffect(() => {
    // Never act before the persisted selection has been READ: a null activeId
    // during the async SecureStore read is "unknown", not "none", and picking
    // here overwrote the user's saved workspace whenever the workspaces fetch
    // beat the hydrate (observed on-device under e2e load).
    if (!hydrated) return;
    if (!workspaces || workspaces.length === 0) return;
    if (!activeId || !workspaces.some((w) => w.id === activeId)) {
      void setActive(workspaces[0].id);
    }
  }, [workspaces, activeId, hydrated, setActive]);

  // No workspaces at all is OnboardingFlow's territory (it owns creating the
  // first one). This gate only ever guarantees a SELECTION exists among
  // workspaces that already do - loading and empty both just pass through.
  return <>{children}</>;
}
