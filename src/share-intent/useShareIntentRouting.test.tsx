import { renderHook, act } from "@testing-library/react-native";
import { useShareIntentRouting } from "./useShareIntentRouting";
import { useShareIntentStore } from "./store";
import { useAuthStore } from "@/auth/authStore";
import { startShareIntentListener } from "./listener";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }),
  useRootNavigationState: () => ({ key: "root" }),
}));

const mockDispose = jest.fn();
jest.mock("./listener", () => ({ startShareIntentListener: jest.fn(() => mockDispose) }));

jest.mock("@/auth/authStore", () => {
  const { create } = jest.requireActual("zustand");
  return { useAuthStore: create(() => ({ status: "signedIn" })) };
});

const pdf = { uri: "content://downloads/42", name: "a.pdf", size: 1, mime: "application/pdf" };

beforeEach(() => {
  jest.clearAllMocks();
  useShareIntentStore.setState({ pending: null });
  useAuthStore.setState({ status: "signedIn" });
});

describe("useShareIntentRouting", () => {
  it("starts listening for incoming shares", () => {
    renderHook(() => useShareIntentRouting());
    expect(startShareIntentListener).toHaveBeenCalled();
  });

  it("never navigates from the root layout, even signed in with a file parked", () => {
    // Regression for Sentry 155694028 (iOS 1.0.5 build 42, cold start from the
    // Files app): pushing from here while the gates hid the real <Stack> pushed
    // a second copy of the root layout onto expo-router's internal `__root`
    // stack, whose copy of this hook pushed again, until React's update-depth
    // limit took Hermes down. The push lives in ShareIntentRedirect now.
    renderHook(() => useShareIntentRouting());
    act(() => useShareIntentStore.getState().receive([pdf]));
    expect(mockPush).not.toHaveBeenCalled();
    expect(useShareIntentStore.getState().pending).toEqual([pdf]);
  });

  it("keeps a share parked across auth resolving", () => {
    useAuthStore.setState({ status: "loading" });
    renderHook(() => useShareIntentRouting());
    act(() => useShareIntentStore.getState().receive([pdf]));
    act(() => useAuthStore.setState({ status: "signedIn" }));
    expect(useShareIntentStore.getState().pending).toEqual([pdf]);
  });

  it("stops listening when unmounted", () => {
    const { unmount } = renderHook(() => useShareIntentRouting());
    unmount();
    expect(mockDispose).toHaveBeenCalled();
  });

  it("drops a parked share when the user signs out", () => {
    // Account-scoped, like everything purgeAccountData clears: a file parked by
    // one account must not appear in the next account's session.
    renderHook(() => useShareIntentRouting());
    act(() => useShareIntentStore.getState().receive([pdf]));
    act(() => useAuthStore.setState({ status: "signedOut" }));
    expect(useShareIntentStore.getState().pending).toBeNull();
  });
});
