// How far this phone has read, summed over the user's workspaces, for the
// background reader (Android's notification count, the background windows'
// onProgress). Only workspaces being read count: ready and not paused here.
import type { EngineStatus, PersonasEngine } from "@dosya-dev/personas-engine";
import { timedSignal, untilAborted } from "./abort";

/** The workspace list must not hold a background window (and the read lock) on a stalled connection. */
const WORKSPACES_TIMEOUT_MS = 15_000;

export type ReadyStatus = Extract<EngineStatus, { state: "ready" }>;

export interface WorkspaceEngines<E extends Pick<PersonasEngine, "status"> = Pick<PersonasEngine, "status">> {
  /** The signed-in user's workspace ids (asks the server). */
  workspaces(): Promise<string[]>;
  engine(workspaceId: string): E;
}

/** The app's own: the workspace list from the API and the hosted engines (both loaded on first use). */
export function appWorkspaceEngines(): WorkspaceEngines<PersonasEngine> {
  return {
    async workspaces() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { apiRequest } = require("@/api/client") as typeof import("@/api/client");
      const limit = timedSignal(WORKSPACES_TIMEOUT_MS);
      try {
        const res = await untilAborted(apiRequest<{ ok: true; workspaces: { id: string }[] }>("/api/workspaces", { signal: limit.signal }), limit.signal);
        return res.workspaces.map((w) => w.id);
      } finally {
        limit.clear();
      }
    },
    engine(workspaceId) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require("./engine-host") as typeof import("./engine-host")).personasEngine(workspaceId);
    },
  };
}

/** The status of every workspace being read on this phone; one that cannot answer is left out. */
export async function readingStatuses<E extends Pick<PersonasEngine, "status">>(d: WorkspaceEngines<E>): Promise<{ engine: E; status: ReadyStatus }[]> {
  const out: { engine: E; status: ReadyStatus }[] = [];
  for (const ws of await d.workspaces()) {
    try {
      const engine = d.engine(ws);
      const status = await engine.status();
      if (status.state === "ready" && !status.paused) out.push({ engine, status });
    } catch {
      /* signed out, offline with nothing cached: not being read */
    }
  }
  return out;
}

/** Photos read and photos to read, summed over the workspaces being read (an uncounted workspace adds 0). */
export async function personasProgressTotals(deps: WorkspaceEngines = appWorkspaceEngines()): Promise<{ read: number; total: number }> {
  let read = 0;
  let total = 0;
  for (const { status } of await readingStatuses(deps)) {
    read += status.read;
    total += status.total ?? 0;
  }
  return { read, total };
}
