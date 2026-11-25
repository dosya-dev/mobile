import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
// Real expo-router's Stack.Screen calls useRoute(), which throws outside an
// actual navigator (see app/duplicates.test.tsx, app/trash.test.tsx for the
// same pattern). This screen never reads route params, so a no-op stands in.
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
import VaultDiagnosticsScreen, { __setDiagnosticsRunnerForTests } from "./vault-diagnostics";
import type { DiagnosticsReport } from "@/vault/diagnostics";

const passing: DiagnosticsReport = {
  backendName: "react-native-libsodium",
  selfTest: { ok: true, total: 27, failures: [] },
  binaryAd: { ok: true, detail: "ok" },
  chunker: { ok: true, checkedSizes: [0, 1], detail: "2 vectors match" },
  timings: { argon2InteractiveMs: 310, encryptMBps: 42.5, sha256MBps: 120 },
};

describe("vault-diagnostics screen", () => {
  afterEach(() => __setDiagnosticsRunnerForTests(null));

  it("runs the diagnostics on mount and shows the summary lines", async () => {
    __setDiagnosticsRunnerForTests(async () => passing);
    render(<VaultDiagnosticsScreen />);
    expect(screen.getByText("Running…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Self-test: PASS")).toBeTruthy());
    expect(screen.getByText("Chunker: PASS")).toBeTruthy();
    expect(screen.getByText("Binary AD: PASS")).toBeTruthy();
    expect(screen.getByText("Argon2id interactive: 310 ms")).toBeTruthy();
    expect(screen.getByTestId("vault-diagnostics-verdict").props.children).toBe("PASS");
  });

  it("shows FAIL and the runner's error when the runtime cannot start", async () => {
    __setDiagnosticsRunnerForTests(async () => { throw new Error("native module unavailable"); });
    render(<VaultDiagnosticsScreen />);
    await waitFor(() => expect(screen.getByText("Self-test: FAIL")).toBeTruthy());
    expect(screen.getByText("native module unavailable")).toBeTruthy();
    expect(screen.getByTestId("vault-diagnostics-verdict").props.children).toBe("FAIL");
  });
});
