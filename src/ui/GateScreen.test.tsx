import { act, render, screen, fireEvent } from "@testing-library/react-native";
import { GateScreen, SPINNER_AFTER_MS, STALLED_AFTER_MS } from "./GateScreen";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

describe("GateScreen", () => {
  it("shows nothing at first, so a fast load never flashes a spinner", () => {
    render(<GateScreen />);
    expect(screen.queryByTestId("gate-spinner")).toBeNull();
  });

  it("owns up to being slow", () => {
    render(<GateScreen />);
    advance(SPINNER_AFTER_MS + 1);
    expect(screen.getByTestId("gate-spinner")).toBeTruthy();
    expect(screen.queryByTestId("gate-stalled")).toBeNull();
  });

  // The 2.1(a) rejection: "page became unresponsive during onboarding", on a
  // device with an active connection. A gate that waits on a request with no
  // timeout, retried twice, can hold for about three minutes - and it used to
  // hold as an empty screen. A bounded wait that explains itself and offers a
  // way out is the difference between "slow" and "broken".
  it("stops pretending after long enough, and offers a way out", () => {
    const onRetry = jest.fn();
    render(<GateScreen onRetry={onRetry} />);
    advance(STALLED_AFTER_MS + 1);
    expect(screen.getByTestId("gate-stalled")).toBeTruthy();
    fireEvent.press(screen.getByTestId("gate-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("still explains the stall when there is nothing to retry", () => {
    render(<GateScreen />);
    advance(STALLED_AFTER_MS + 1);
    expect(screen.getByTestId("gate-stalled")).toBeTruthy();
    expect(screen.queryByTestId("gate-retry")).toBeNull();
  });

  it("gives up its timers on unmount", () => {
    const view = render(<GateScreen />);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
