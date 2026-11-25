import { act, render } from "@testing-library/react-native";
import { PendingReportRedirect } from "./PendingReportRedirect";
import { useReportStore } from "./reportStore";

// Named mockPush, not push: babel-plugin-jest-hoist refuses to let a
// jest.mock() factory close over an out-of-scope variable unless its name
// starts with "mock" (same convention as app/_layout.test.tsx's mockBack).
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

beforeEach(() => {
  mockPush.mockReset();
  useReportStore.getState().setPending(null);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("pushes the report screen once when a report is pending, then forgets it", () => {
  useReportStore.getState().setPending({ from: "/files", errorRef: "evt_1", errorMessage: "boom" });
  render(<PendingReportRedirect />);
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/report-problem", params: { from: "/files", errorRef: "evt_1", errorMessage: "boom" } });
  expect(useReportStore.getState().pending).toBeNull();
});

it("does nothing when nothing is pending", () => {
  render(<PendingReportRedirect />);
  act(() => { jest.runAllTimers(); });
  expect(mockPush).not.toHaveBeenCalled();
});

it("fills in a missing field with an empty string rather than the literal null", () => {
  useReportStore.getState().setPending({ from: null, errorRef: "evt_1", errorMessage: "boom" });
  render(<PendingReportRedirect />);
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/report-problem", params: { from: "", errorRef: "evt_1", errorMessage: "boom" } });
});

it("pushes exactly once across a re-render", () => {
  useReportStore.getState().setPending({ from: "/files", errorRef: "evt_1", errorMessage: "boom" });
  const { rerender } = render(<PendingReportRedirect />);
  act(() => { jest.runAllTimers(); });
  rerender(<PendingReportRedirect />);
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it("swallows a push that throws because the navigator is not mounted yet", () => {
  useReportStore.getState().setPending({ from: "/files", errorRef: "evt_1", errorMessage: "boom" });
  mockPush.mockImplementationOnce(() => {
    throw new Error("Attempted to navigate before mounting the Root Layout component");
  });
  render(<PendingReportRedirect />);
  expect(() => act(() => { jest.runAllTimers(); })).not.toThrow();
  expect(useReportStore.getState().pending).toBeNull();
});
