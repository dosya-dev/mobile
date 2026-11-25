// Personas is on every plan and runs on each member's own phone: the Files
// chip shows for every signed-in user, with nothing asked of a server.
import { act, renderHook } from "@testing-library/react-native";

const mockUser = { id: null as string | null, fns: new Set<() => void>() };
jest.mock("./device/teardown", () => ({
  personasUser: () => mockUser.id,
  subscribePersonasUser: (fn: () => void) => { mockUser.fns.add(fn); return () => mockUser.fns.delete(fn); },
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1", name: "Home" }] }) }));
jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: (sel: (s: { activeId: string | null }) => unknown) => sel({ activeId: null }) }));

import { usePersonasEntry, usePersonasWorkspace } from "./hooks";

const setUser = (id: string | null) => act(() => { mockUser.id = id; for (const f of mockUser.fns) f(); });

it("shows the entry for a signed-in user in a workspace, and hides it signed out or without a workspace", () => {
  const { result, rerender } = renderHook(({ ws }: { ws: string | null }) => usePersonasEntry(ws), { initialProps: { ws: "w1" as string | null } });
  expect(result.current.visible).toBe(false);
  setUser("u1");
  expect(result.current.visible).toBe(true);
  rerender({ ws: null });
  expect(result.current.visible).toBe(false);
  rerender({ ws: "w1" });
  setUser(null);
  expect(result.current.visible).toBe(false);
});

it("the Personas screens' workspace is the active one, else the first", () => {
  const { result } = renderHook(() => usePersonasWorkspace());
  expect(result.current).toEqual({ wsId: "w1", workspaceName: "Home" });
});
