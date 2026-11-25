const mockNet = {
  initial: null as null | { isConnected?: boolean; isInternetReachable?: boolean | null; type?: string },
  listeners: [] as ((e: unknown) => void)[],
};
jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn(() => (mockNet.initial ? Promise.resolve(mockNet.initial) : new Promise(() => {}))),
  addNetworkStateListener: jest.fn((fn: (e: unknown) => void) => {
    mockNet.listeners.push(fn);
    return { remove: () => { mockNet.listeners = mockNet.listeners.filter((l) => l !== fn); } };
  }),
}));

import { act, renderHook } from "@testing-library/react-native";
import { isOnlineNow, useIsOnline, __resetOnlineForTests } from "./network";

const emit = (e: unknown) => { for (const l of [...mockNet.listeners]) l(e); };

beforeEach(() => {
  mockNet.initial = null;
  mockNet.listeners = [];
  __resetOnlineForTests();
});

describe("online state", () => {
  it("unknown is null until the first answer", () => {
    expect(isOnlineNow()).toBeNull();
    const { result } = renderHook(() => useIsOnline());
    expect(result.current).toBeNull();
  });

  it("follows the listener", () => {
    const { result } = renderHook(() => useIsOnline());
    act(() => emit({ isConnected: false, type: "NONE" }));
    expect(result.current).toBe(false);
    expect(isOnlineNow()).toBe(false);
    act(() => emit({ isConnected: true, type: "WIFI" }));
    expect(result.current).toBe(true);
  });

  it("connected with no internet reads as offline", () => {
    renderHook(() => useIsOnline());
    act(() => emit({ isConnected: true, isInternetReachable: false, type: "WIFI" }));
    expect(isOnlineNow()).toBe(false);
  });

  it("an unknown reachability does not count as offline", () => {
    renderHook(() => useIsOnline());
    act(() => emit({ isConnected: true, isInternetReachable: null, type: "CELLULAR" }));
    expect(isOnlineNow()).toBe(true);
  });

  it("reads the initial state", async () => {
    mockNet.initial = { isConnected: false };
    const { result } = renderHook(() => useIsOnline());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);
  });

  it("a listener event wins over a slower initial read", async () => {
    let resolve!: (v: unknown) => void;
    mockNet.initial = null;
    const Network = jest.requireMock("expo-network") as { getNetworkStateAsync: jest.Mock };
    Network.getNetworkStateAsync.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    renderHook(() => useIsOnline());
    act(() => emit({ isConnected: true, type: "WIFI" }));
    await act(async () => { resolve({ isConnected: false }); await Promise.resolve(); });
    expect(isOnlineNow()).toBe(true);
  });
});
