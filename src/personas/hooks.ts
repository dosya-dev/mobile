// Who sees Personas, and which workspace its screens show. Ported from
// apps/desktop/src/renderer/lib/use-personas-access.ts - keep in step.
//
// Personas runs on each member's own devices and is free on every plan, so
// its entry points (the Files chip) show for every signed-in user. Nothing is
// asked of a server. The signed-in user comes from ./device/teardown, which
// does not load the engine.
import { useSyncExternalStore } from "react";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { personasUser, subscribePersonasUser } from "./device/teardown";

export interface PersonasEntry {
  /** Signed in, with a workspace: show the entry point. */
  visible: boolean;
}

export function usePersonasEntry(wsId: string | null): PersonasEntry {
  const signedIn = useSyncExternalStore(subscribePersonasUser, () => personasUser() !== null, () => false);
  return { visible: signedIn && !!wsId };
}

/** The active workspace, as the Personas screens read it. */
export function usePersonasWorkspace(): { wsId: string | null; workspaceName: string } {
  const workspaces = useWorkspaces();
  const wsId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const workspaceName = workspaces.data?.find((w) => w.id === wsId)?.name ?? "";
  return { wsId, workspaceName };
}
