import { deriveEngineStatus, engineLabel } from "./engineStatus";

describe("deriveEngineStatus", () => {
  it("maps engine state to a status word", () => {
    expect(deriveEngineStatus({ phase: "scanning", hasActiveUploads: false, blocked: false, autoBackup: false })).toBe("scanning");
    expect(deriveEngineStatus({ phase: "uploading", hasActiveUploads: true, blocked: false, autoBackup: false })).toBe("backing-up");
    // scanning wins even if uploads are already in flight
    expect(deriveEngineStatus({ phase: "scanning", hasActiveUploads: true, blocked: false, autoBackup: false })).toBe("scanning");
    expect(deriveEngineStatus({ phase: "idle", hasActiveUploads: false, blocked: true, autoBackup: true })).toBe("paused");
    expect(deriveEngineStatus({ phase: "idle", hasActiveUploads: false, blocked: false, autoBackup: true })).toBe("protected");
    expect(deriveEngineStatus({ phase: "idle", hasActiveUploads: false, blocked: false, autoBackup: false })).toBe("ready");
  });

  it("reports a policy hold as a pause while a run is in progress, not when idle", () => {
    expect(deriveEngineStatus({ phase: "uploading", hasActiveUploads: true, blocked: false, autoBackup: true, holdReason: "waiting for Wi-Fi" })).toBe("holding");
    expect(deriveEngineStatus({ phase: "scanning", hasActiveUploads: false, blocked: false, autoBackup: true, holdReason: "waiting for charger" })).toBe("holding");
    expect(deriveEngineStatus({ phase: "idle", hasActiveUploads: false, blocked: false, autoBackup: true, holdReason: "waiting for Wi-Fi" })).toBe("protected");
  });

  it("lets a thermal pause win over everything else while work is pending, but not when idle", () => {
    expect(deriveEngineStatus({ phase: "uploading", hasActiveUploads: true, blocked: false, autoBackup: true, holdReason: "waiting for Wi-Fi", coolingDown: true })).toBe("cooling");
    expect(deriveEngineStatus({ phase: "scanning", hasActiveUploads: false, blocked: false, autoBackup: false, coolingDown: true })).toBe("cooling");
    expect(deriveEngineStatus({ phase: "idle", hasActiveUploads: false, blocked: false, autoBackup: true, coolingDown: true })).toBe("protected");
  });
});

describe("engineLabel", () => {
  it.each([
    ["scanning", "Scanning…"],
    ["cooling", "Cooling down…"],
    ["backing-up", "Backing up"],
    ["paused", "Paused"],
    ["protected", "Protected"],
    ["ready", "Ready"],
  ] as const)("labels %s as %s", (status, label) => {
    expect(engineLabel(status)).toBe(label);
  });

  it("says what a held run is waiting for", () => {
    expect(engineLabel("holding", "waiting for Wi-Fi")).toBe("Paused - waiting for Wi-Fi");
    expect(engineLabel("holding", null)).toBe("Paused");
  });
});
