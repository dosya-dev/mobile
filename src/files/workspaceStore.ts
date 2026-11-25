import { create } from "zustand";
import { getItem, setItem, deleteItem } from "@/lib/keychain";

const KEY = "dosya.workspace";

interface WorkspaceState {
  activeId: string | null;
  /** True once the persisted selection has been read. Auto-pickers (WorkspaceGate,
   * WorkspaceSwitcher) MUST wait for it: acting while activeId is merely
   * not-yet-loaded overwrote the user's saved workspace with the server's
   * first one whenever the workspaces fetch won the boot race. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  /** Account purge (sign-out): the next account must not inherit this one's workspace. */
  reset: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeId: null,
  hydrated: false,
  hydrate: async () => {
    const id = await getItem(KEY);
    set({ activeId: id, hydrated: true });
  },
  setActive: async (id) => {
    set({ activeId: id });
    await setItem(KEY, id);
  },
  reset: async () => {
    set({ activeId: null });
    await deleteItem(KEY);
  },
}));
