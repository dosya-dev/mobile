import { create } from "zustand";

export interface MaintenanceInfo {
  surface: string;
  message: string | null;
}

interface MaintenanceState {
  maintenance: MaintenanceInfo | null;
  set: (m: MaintenanceInfo) => void;
  clear: () => void;
}

/**
 * Whether the API just answered a gated request with `surface_disabled` -
 * the mobile platform switch is off. Set from `apiRequest` (see
 * src/api/client.ts) the moment a 503 with that code comes back, so the root
 * layout can swap the whole gates/navigator tree for MaintenanceScreen
 * regardless of which screen happened to make the request.
 *
 * Never cleared by a failed request - only a successful one (see
 * MaintenanceScreen's retry) proves the surface is back.
 */
export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  maintenance: null,
  set: (m) => set({ maintenance: m }),
  clear: () => set({ maintenance: null }),
}));
