import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import * as Sentry from "@sentry/react-native";
import {
  DIRECTION_RELOAD_KEY,
  __setLayoutRtlForTests,
  layoutIsRtl,
  needsReload,
  reloadForDirection,
  syncNativeDirection,
} from "./direction";

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock("@/lib/keychain", () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItem: (...a: unknown[]) => mockSetItem(...a),
}));
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn() }));

const reload = reloadAppAsync as jest.Mock;

function native(isRTL: boolean, doLeftAndRightSwapInRTL: boolean) {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({ isRTL, doLeftAndRightSwapInRTL } as never);
}

beforeEach(() => {
  mockGetItem.mockReset().mockResolvedValue(null);
  mockSetItem.mockReset().mockResolvedValue(undefined);
  reload.mockReset().mockResolvedValue(undefined);
  (Sentry.addBreadcrumb as jest.Mock).mockClear();
  native(false, false);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("needsReload", () => {
  it.each([
    // isRTL, swap, want rtl, expected
    [false, false, true, true],
    [false, true, true, true],
    [true, true, true, true],
    [true, false, true, false],
    [true, false, false, true],
    [true, true, false, true],
    [false, false, false, false],
    [false, true, false, false],
  ])("isRTL=%s swap=%s want rtl=%s -> %s", (isRTL, swap, rtl, expected) => {
    native(isRTL, swap);
    expect(needsReload(rtl)).toBe(expected);
  });

  it("reads the native value unless a test seam overrides it", () => {
    native(true, false);
    expect(layoutIsRtl()).toBe(true);
    __setLayoutRtlForTests(false);
    expect(layoutIsRtl()).toBe(false);
    __setLayoutRtlForTests(null);
    expect(layoutIsRtl()).toBe(true);
  });
});

describe("syncNativeDirection", () => {
  it("sets allow, force and swap-off for RTL", () => {
    const allow = jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {});
    const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});
    const swap = jest.spyOn(I18nManager, "swapLeftAndRightInRTL").mockImplementation(() => {});
    syncNativeDirection(true);
    expect(allow).toHaveBeenCalledWith(true);
    expect(force).toHaveBeenCalledWith(true);
    expect(swap).toHaveBeenCalledWith(false);
  });

  it("clears allow and force for LTR and keeps the swap off", () => {
    const allow = jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {});
    const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});
    const swap = jest.spyOn(I18nManager, "swapLeftAndRightInRTL").mockImplementation(() => {});
    syncNativeDirection(false);
    expect(allow).toHaveBeenCalledWith(false);
    expect(force).toHaveBeenCalledWith(false);
    expect(swap).toHaveBeenCalledWith(false);
  });

  it("never throws", () => {
    jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {
      throw new Error("native gone");
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => syncNativeDirection(true)).not.toThrow();
  });
});

describe("reloadForDirection", () => {
  it("reloads, and stamps the guard key with the time and the target direction first", async () => {
    jest.useFakeTimers().setSystemTime(1_000_000);
    await expect(reloadForDirection("direction", true)).resolves.toBe("reloading");
    expect(mockSetItem).toHaveBeenCalledWith(DIRECTION_RELOAD_KEY, "1000000:1");
    expect(reload).toHaveBeenCalledWith("direction");
    await expect(reloadForDirection("direction", false)).resolves.toBe("reloading");
    expect(mockSetItem).toHaveBeenLastCalledWith(DIRECTION_RELOAD_KEY, "1000000:0");
  });

  it("refuses a second reload to the same direction within 60 s, with a breadcrumb, and reloads again after 61 s", async () => {
    jest.useFakeTimers().setSystemTime(1_000_000);
    let stored: string | null = null;
    mockGetItem.mockImplementation(async () => stored);
    mockSetItem.mockImplementation(async (_k: string, v: string) => {
      stored = v;
    });
    expect(await reloadForDirection("direction", true)).toBe("reloading");
    jest.setSystemTime(1_000_000 + 30_000);
    expect(await reloadForDirection("direction", true)).toBe("guarded");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    jest.setSystemTime(1_000_000 + 61_000);
    expect(await reloadForDirection("direction", true)).toBe("reloading");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("allows a reload back to the other direction within 60 s: that is a switch, not a loop", async () => {
    jest.useFakeTimers().setSystemTime(1_000_000);
    let stored: string | null = null;
    mockGetItem.mockImplementation(async () => stored);
    mockSetItem.mockImplementation(async (_k: string, v: string) => {
      stored = v;
    });
    expect(await reloadForDirection("direction-switch", true)).toBe("reloading");
    jest.setSystemTime(1_000_000 + 10_000);
    expect(await reloadForDirection("direction-switch", false)).toBe("reloading");
    expect(reload).toHaveBeenCalledTimes(2);
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it("treats a stamp without a direction as the same direction (refuses)", async () => {
    jest.useFakeTimers().setSystemTime(1_000_000);
    mockGetItem.mockResolvedValue(String(1_000_000 - 5_000));
    expect(await reloadForDirection("direction", false)).toBe("guarded");
    expect(reload).not.toHaveBeenCalled();
  });

  it("returns failed when the reload throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    reload.mockRejectedValue(new Error("no reload"));
    await expect(reloadForDirection("direction", true)).resolves.toBe("failed");
  });

  it("still reloads when the keychain cannot be read or written", async () => {
    mockGetItem.mockRejectedValue(new Error("locked"));
    mockSetItem.mockRejectedValue(new Error("locked"));
    await expect(reloadForDirection("direction", true)).resolves.toBe("reloading");
  });
});
