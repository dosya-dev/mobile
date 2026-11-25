import { render, screen, fireEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import type { ReactNode } from "react";
import * as Sentry from "@sentry/react-native";
import { ErrorBoundary } from "./ErrorBoundary";

// jest-hoist only allows out-of-scope identifiers prefixed "mock" inside a
// jest.mock() factory; ErrorBoundary reads status at render time via
// getState(), so the mock only needs to answer that one call.
let mockAuthStatus: "loading" | "signedOut" | "signedIn" = "signedIn";
jest.mock("@/auth/authStore", () => ({
  useAuthStore: { getState: () => ({ status: mockAuthStatus }) },
}));

function Boom(): never {
  throw new Error("kaboom");
}

// React re-invokes a component that threw a second time in development (to
// get a clean stack trace), so a child that stops throwing on its OWN first
// re-render (a ref, a module counter) cannot tell a real reset from that
// extra invocation. Flipping the flag from the boundary's onReset callback
// instead - which fires synchronously inside the same batched update, before
// the reset's re-render runs at all - proves the reset actually recovered.
let stopThrowing = false;
function Flaky(): ReactNode {
  if (stopThrowing) return null;
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    mockAuthStatus = "signedIn";
    stopThrowing = false;
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Text>safe child</Text>
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe child")).toBeTruthy();
  });

  it("renders the fallback when a child throws during render", () => {
    // React logs the caught error to console.error; silence it for a clean run.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByTestId("error-retry")).toBeTruthy();
    spy.mockRestore();
  });

  it("reports the caught error to Sentry with the component stack", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    (Sentry.captureException as jest.Mock).mockClear();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [error, hint] = (Sentry.captureException as jest.Mock).mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("kaboom");
    expect(hint.extra.componentStack).toEqual(expect.stringContaining("Boom"));
    spy.mockRestore();
  });

  it("calls onReset when 'Try again' is pressed", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const onReset = jest.fn();
    render(
      <ErrorBoundary onReset={onReset}>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.press(screen.getByTestId("error-retry"));
    expect(onReset).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("offers Report this problem, parks the report with the id and message, and resets", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { useReportStore } = require("@/support/reportStore") as typeof import("@/support/reportStore");
    useReportStore.getState().setPending(null);
    render(
      <ErrorBoundary onReset={() => { stopThrowing = true; }}>
        <Flaky />
      </ErrorBoundary>,
    );
    fireEvent.press(screen.getByTestId("error-report"));
    expect(useReportStore.getState().pending).toEqual(
      expect.objectContaining({ from: null, errorRef: "evt_mock", errorMessage: "kaboom" }),
    );
    expect(screen.queryByText("Something went wrong")).toBeNull();
    spy.mockRestore();
  });

  it("hides Report this problem when signed out", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockAuthStatus = "signedOut";
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByTestId("error-report")).toBeNull();
    spy.mockRestore();
  });
});
