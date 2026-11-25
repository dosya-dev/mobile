import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("expo-asset", () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock("expo-file-system/legacy", () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: "base64" } }));
jest.mock("../modules/dosya-face-reader", () => ({ isNativeFaceReaderAvailable: jest.fn() }));
jest.mock("@/personas/device/models", () => ({ ensureFaceModels: jest.fn() }));
jest.mock("@/personas/device/native-reader", () => ({ createNativeReader: jest.fn() }));
jest.mock("@/personas/device/health", () => ({ recentWindows: jest.fn(async () => []) }));
import PersonasParityScreen, { __setParityRunnerForTests, runParity } from "./personas-parity";
import { isNativeFaceReaderAvailable } from "../modules/dosya-face-reader";
import { ensureFaceModels } from "@/personas/device/models";
import { createNativeReader } from "@/personas/device/native-reader";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { recentWindows } from "@/personas/device/health";

const available = isNativeFaceReaderAvailable as jest.Mock;

describe("personas-parity screen", () => {
  afterEach(() => __setParityRunnerForTests(null));

  it("shows PASS with the runner's lines", async () => {
    available.mockReturnValue(true);
    __setParityRunnerForTests(async () => ({ ok: true, lines: ["crew.jpg #0 box 0.10 px cos 1.0000", "crew.jpg: 812 ms"] }));
    render(<PersonasParityScreen />);
    await waitFor(() => expect(screen.getByTestId("personas-parity-verdict").props.children).toBe("PASS"));
    expect(screen.getByTestId("personas-parity-line-1").props.children).toBe("crew.jpg: 812 ms");
  });

  it("shows FAIL when the comparison fails or the run throws", async () => {
    available.mockReturnValue(true);
    __setParityRunnerForTests(async () => ({ ok: false, lines: ["crew.jpg: FAIL expected 2 faces, got 1"] }));
    const { unmount } = render(<PersonasParityScreen />);
    await waitFor(() => expect(screen.getByTestId("personas-parity-verdict").props.children).toBe("FAIL"));
    unmount();
    __setParityRunnerForTests(async () => { throw new Error("boom"); });
    render(<PersonasParityScreen />);
    await waitFor(() => expect(screen.getByTestId("personas-parity-line-0").props.children).toBe("boom"));
  });

  it("says so when the native reader is absent, without running", () => {
    available.mockReturnValue(false);
    const runner = jest.fn();
    __setParityRunnerForTests(runner);
    render(<PersonasParityScreen />);
    expect(screen.getByText("Native reader not available")).toBeTruthy();
    expect(runner).not.toHaveBeenCalled();
  });

  it("runParity reads each bundled photo and reports per-photo ms", async () => {
    (ensureFaceModels as jest.Mock).mockResolvedValue(true);
    (Asset.fromModule as jest.Mock).mockReturnValue({ downloadAsync: jest.fn().mockResolvedValue(undefined), localUri: "file:///x.jpg" });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("AQID");
    const read = jest.fn().mockResolvedValue([]);
    const unload = jest.fn().mockResolvedValue(undefined);
    (createNativeReader as jest.Mock).mockReturnValue({ read, unload });
    const r = await runParity();
    expect(read).toHaveBeenCalledTimes(3);
    expect(Array.from(read.mock.calls[0][0] as Uint8Array)).toEqual([1, 2, 3]);
    expect(unload).toHaveBeenCalled();
    expect(r.ok).toBe(false); // no faces read, reference expects some
    expect(r.lines.filter((l) => / ms$/.test(l))).toHaveLength(3);
  });

  it("lists the recent background windows, newest first", async () => {
    available.mockReturnValue(false);
    (recentWindows as jest.Mock).mockResolvedValueOnce([
      { at: Date.UTC(2026, 10, 2, 3, 4, 5), kind: "processing", ms: 45_000, photos: 312, end: "deadline", platform: "ios", mode: "charging" },
      { at: Date.UTC(2026, 10, 1, 22, 0, 0), kind: "worker", ms: 1_500, photos: 0, end: "error", platform: "android", mode: "anytime" },
    ]);
    render(<PersonasParityScreen />);
    expect(await screen.findByText("Background windows (2)")).toBeTruthy();
    const first = screen.getByTestId("personas-parity-window-0").props.children as string;
    expect(first).toContain("processing");
    expect(first).toContain("312 photos");
    expect(first).toContain("45.0 s");
    expect(first).toContain("deadline");
    expect(first).toContain("charging");
    expect(screen.getByTestId("personas-parity-window-1").props.children).toContain("error");
  });

  it("says when no background window has run", async () => {
    available.mockReturnValue(false);
    render(<PersonasParityScreen />);
    expect(await screen.findByText("Background windows (0)")).toBeTruthy();
    expect(screen.getByText("No background window yet")).toBeTruthy();
  });
});
