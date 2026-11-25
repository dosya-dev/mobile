import { useMaintenanceStore } from "./maintenanceStore";

beforeEach(() => useMaintenanceStore.setState({ maintenance: null }));

describe("useMaintenanceStore", () => {
  it("starts with no maintenance", () => {
    expect(useMaintenanceStore.getState().maintenance).toBeNull();
  });

  it("set() records the surface and message", () => {
    useMaintenanceStore.getState().set({ surface: "mobile", message: "brb" });
    expect(useMaintenanceStore.getState().maintenance).toEqual({ surface: "mobile", message: "brb" });
  });

  it("set() accepts a null message", () => {
    useMaintenanceStore.getState().set({ surface: "mobile", message: null });
    expect(useMaintenanceStore.getState().maintenance).toEqual({ surface: "mobile", message: null });
  });

  it("clear() resets to null", () => {
    useMaintenanceStore.getState().set({ surface: "mobile", message: "brb" });
    useMaintenanceStore.getState().clear();
    expect(useMaintenanceStore.getState().maintenance).toBeNull();
  });
});
