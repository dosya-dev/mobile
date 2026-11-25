// Totals for the background notification and progress: summed over the
// workspaces this phone reads.
import type { EngineStatus } from "@dosya-dev/personas-engine";
import { personasProgressTotals } from "./progress";

const eng = (st: EngineStatus) => ({ status: async () => st });
const ready = (read: number, total: number | null, paused = false): EngineStatus => ({ state: "ready", read, total, reading: false, paused });

it("sums across ready engines; ignores off and needs_unlock engines", async () => {
  const m: Record<string, ReturnType<typeof eng>> = {
    a: eng(ready(10, 40)),
    b: eng(ready(5, 5)),
    c: eng({ state: "off" }),
    d: eng({ state: "needs_unlock" }),
    e: eng(ready(0, null)),
  };
  expect(await personasProgressTotals({ workspaces: async () => Object.keys(m), engine: (ws) => m[ws] })).toEqual({ read: 15, total: 45 });
});

it("leaves out paused engines and engines whose status fails", async () => {
  const m: Record<string, { status: () => Promise<EngineStatus> }> = {
    a: eng(ready(1, 2)),
    b: eng(ready(7, 9, true)),
    c: { status: async () => { throw new Error("offline"); } },
  };
  expect(await personasProgressTotals({ workspaces: async () => Object.keys(m), engine: (ws) => m[ws] })).toEqual({ read: 1, total: 2 });
});

it("is zero with no workspaces", async () => {
  expect(await personasProgressTotals({ workspaces: async () => [], engine: () => { throw new Error("unused"); } })).toEqual({ read: 0, total: 0 });
});
