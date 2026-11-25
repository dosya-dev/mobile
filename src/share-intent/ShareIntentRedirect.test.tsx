import { act, render } from "@testing-library/react-native";
import { ShareIntentRedirect, MAX_ATTEMPTS, RETRY_MS } from "./ShareIntentRedirect";
import { useShareIntentStore } from "./store";

// Named mockPush: babel-plugin-jest-hoist only lets a jest.mock() factory close
// over out-of-scope variables whose names start with "mock".
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

const pdf = { uri: "file:///Documents/Inbox/a.pdf", name: "a.pdf", size: 1, mime: "application/pdf" };

beforeEach(() => {
  mockPush.mockReset();
  useShareIntentStore.setState({ pending: null });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("opens the picker for a file parked before the Stack mounted (cold start)", () => {
  // The Files-app cold start: the URL is parked long before the gates let this
  // component render. Mounting is the signal that a navigator exists.
  useShareIntentStore.getState().receive([pdf]);
  render(<ShareIntentRedirect />);
  expect(mockPush).not.toHaveBeenCalled(); // deferred: same commit as the Stack
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/save-to");
});

it("opens the picker when a file arrives while the app is already open", () => {
  render(<ShareIntentRedirect />);
  act(() => useShareIntentStore.getState().receive([pdf]));
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledWith("/save-to");
});

it("does nothing when nothing is parked", () => {
  render(<ShareIntentRedirect />);
  act(() => { jest.runAllTimers(); });
  expect(mockPush).not.toHaveBeenCalled();
});

it("opens the picker once per share, not once per render", () => {
  const { rerender } = render(<ShareIntentRedirect />);
  act(() => useShareIntentStore.getState().receive([pdf]));
  rerender(<ShareIntentRedirect />);
  rerender(<ShareIntentRedirect />);
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it("opens the picker again for a second share after the first was taken", () => {
  render(<ShareIntentRedirect />);
  act(() => useShareIntentStore.getState().receive([pdf]));
  act(() => { jest.runAllTimers(); });
  act(() => { useShareIntentStore.getState().take(); }); // the picker mounting
  act(() => useShareIntentStore.getState().receive([pdf]));
  act(() => { jest.runAllTimers(); });
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it("retries a push the navigator was not ready for, then stops", () => {
  mockPush.mockImplementation(() => {
    throw new Error("Attempted to navigate before mounting the Root Layout component");
  });
  useShareIntentStore.getState().receive([pdf]);
  render(<ShareIntentRedirect />);
  act(() => { jest.advanceTimersByTime(RETRY_MS * (MAX_ATTEMPTS + 5)); });
  expect(mockPush).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  // Still parked: a later mount (or the next share) can still reveal it.
  expect(useShareIntentStore.getState().pending).toEqual([pdf]);
});

it("succeeds on a retry once the navigator is ready", () => {
  mockPush.mockImplementationOnce(() => { throw new Error("not ready"); });
  useShareIntentStore.getState().receive([pdf]);
  render(<ShareIntentRedirect />);
  act(() => { jest.advanceTimersByTime(RETRY_MS * 3); });
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it("cancels a pending push when unmounted", () => {
  useShareIntentStore.getState().receive([pdf]);
  const { unmount } = render(<ShareIntentRedirect />);
  unmount();
  act(() => { jest.runAllTimers(); });
  expect(mockPush).not.toHaveBeenCalled();
});
