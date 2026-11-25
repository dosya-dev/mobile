import { useReportStore } from "./reportStore";

describe("reportStore", () => {
  beforeEach(() => { useReportStore.getState().setPending(null); });

  it("holds one pending report and hands it over exactly once", () => {
    useReportStore.getState().setPending({ from: "/files", errorRef: "evt_1", errorMessage: "boom" });
    expect(useReportStore.getState().consumePending()).toEqual({ from: "/files", errorRef: "evt_1", errorMessage: "boom" });
    expect(useReportStore.getState().consumePending()).toBeNull();
  });

  it("drops a report parked more than two minutes ago rather than reviving stale context", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(0);
      useReportStore.getState().setPending({ from: "/files", errorRef: "evt_1", errorMessage: "boom" });
      jest.setSystemTime(3 * 60_000);
      expect(useReportStore.getState().consumePending()).toBeNull();
      // The slot is cleared either way, stale or not.
      expect(useReportStore.getState().pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
