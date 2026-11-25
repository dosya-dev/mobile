import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { FirstLoadSplash } from "./FirstLoadSplash";
import { useAuthStore } from "@/auth/authStore";

// The splash owns the screen between sign-in and the first painted file list.
// These tests drive it through its stages with plain props; the identity block
// reads the signed-in user from the auth store.

const noRetry = () => {};

afterEach(() => {
  jest.useRealTimers();
  useAuthStore.setState({ user: null });
});

it("shows the account stage and no identity before the profile arrives", () => {
  render(
    <FirstLoadSplash
      inputs={{ hasUser: false, workspaceReady: false, filesReady: false }}
      failed={false}
      onRetry={noRetry}
    />,
  );
  expect(screen.getByText("Signing you in…")).toBeTruthy();
  expect(screen.queryByTestId("first-load-identity")).toBeNull();
});

it("reveals the user's name and email once the account stage resolves", () => {
  useAuthStore.setState({ user: { id: "u1", name: "coder kaya", email: "coderonline0@gmail.com" } as never });
  render(
    <FirstLoadSplash
      inputs={{ hasUser: true, workspaceReady: false, filesReady: false }}
      failed={false}
      onRetry={noRetry}
    />,
  );
  expect(screen.getByText("Opening your workspace…")).toBeTruthy();
  expect(screen.getByText("coder kaya")).toBeTruthy();
  expect(screen.getByText("coderonline0@gmail.com")).toBeTruthy();
});

it("shows the files stage once a workspace is chosen", () => {
  render(
    <FirstLoadSplash
      inputs={{ hasUser: true, workspaceReady: true, filesReady: false }}
      failed={false}
      onRetry={noRetry}
    />,
  );
  expect(screen.getByText("Fetching your files…")).toBeTruthy();
});

it("dismisses itself after everything loads, holding the minimum display time", () => {
  jest.useFakeTimers();
  const { rerender } = render(
    <FirstLoadSplash
      inputs={{ hasUser: true, workspaceReady: true, filesReady: false }}
      failed={false}
      onRetry={noRetry}
    />,
  );
  rerender(
    <FirstLoadSplash
      inputs={{ hasUser: true, workspaceReady: true, filesReady: true }}
      failed={false}
      onRetry={noRetry}
    />,
  );
  // Still visible immediately after completion - the anti-flash hold.
  expect(screen.getByTestId("first-load-splash")).toBeTruthy();
  act(() => { jest.advanceTimersByTime(1000); });
  expect(screen.queryByTestId("first-load-splash")).toBeNull();
});

it("shows the error state and lets the user retry", () => {
  const onRetry = jest.fn();
  render(
    <FirstLoadSplash
      inputs={{ hasUser: true, workspaceReady: false, filesReady: false }}
      failed
      onRetry={onRetry}
    />,
  );
  expect(screen.getByText("Couldn't reach dosya.dev.")).toBeTruthy();
  fireEvent.press(screen.getByText("Retry"));
  expect(onRetry).toHaveBeenCalled();
});

it("admits a slow connection after eight seconds instead of faking progress", () => {
  jest.useFakeTimers();
  render(
    <FirstLoadSplash
      inputs={{ hasUser: true, workspaceReady: true, filesReady: false }}
      failed={false}
      onRetry={noRetry}
    />,
  );
  expect(screen.queryByText(/slow connection/i)).toBeNull();
  act(() => { jest.advanceTimersByTime(8100); });
  expect(screen.getByText(/slow connection/i)).toBeTruthy();
});
