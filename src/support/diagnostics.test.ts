import { collectMobileDiagnostics, diagnosticsRows, redactPaths, summariseBackup, DIAGNOSTICS_STRING_MAX } from "./diagnostics";

const FACTS = {
  displayVersion: "1.0.2 (37)", build: "37", osName: "iOS", osVersion: "26.0", model: "iPhone 15",
  locale: "en-GB", workspaceId: "ws_1", backup: { error: 3, skipped: 1 },
};

describe("collectMobileDiagnostics", () => {
  it("builds the v1 mobile document", () => {
    const d = collectMobileDiagnostics(FACTS, { page: "/backup-failed?x=1", errorRef: "evt_1", errorMessage: "boom" }, 1_760_000_000);
    expect(d).toEqual({
      v: 1, client: "mobile", app_version: "1.0.2 (37)", build: "37", platform: "iOS 26.0", locale: "en-GB",
      workspace_id: "ws_1", page: "/backup-failed", error_ref: "evt_1", error_message: "boom",
      extra: { Device: "iPhone 15", Backup: "3 failed · 1 skipped" }, captured_at: 1_760_000_000,
    });
  });

  it("survives every fact being null (jest, Expo Go) and no prefill", () => {
    const d = collectMobileDiagnostics(
      { displayVersion: null, build: null, osName: null, osVersion: null, model: null, locale: null, workspaceId: null, backup: null },
      {}, 1,
    );
    expect(d.app_version).toBe("unknown");
    expect(d.platform).toBe("unknown");
    expect(d.build).toBeNull();
    expect(d.page).toBeNull();
    expect(d.error_ref).toBeNull();
    expect(d.extra).toEqual({});
    expect(JSON.stringify(d)).not.toContain("undefined");
  });

  it("redacts paths and cuts long strings in every field", () => {
    const d = collectMobileDiagnostics(FACTS, { errorMessage: "ENOENT: no such file, open 'file:///var/mobile/Containers/Data/x.jpg' " + "z".repeat(1000) }, 1);
    expect(d.error_message).toContain("open '<path>'");
    expect(d.error_message).not.toContain("/var/mobile");
    expect(d.error_message!.length).toBe(DIAGNOSTICS_STRING_MAX);
  });
});

describe("redactPaths", () => {
  it.each([
    ["file:///var/mobile/Containers/Data/Application/abc/x.jpg", "<path>"],
    ["read /var/mobile/Containers/x failed", "read <path> failed"],
    ["open /data/user/0/dev.dosya/cache/y", "open <path>"],
    ["/storage/emulated/0/DCIM/a.jpg", "<path>"],
    ["from /Users/firat/Desktop/a.heic", "from <path>"],
    ["Network request failed", "Network request failed"],
    ["/storage/emulated/0/Download/My Document.pdf", "<path>"],
    ["open content://media/external/images/1234", "open <path>"],
  ])("%s -> %s", (input, expected) => {
    expect(redactPaths(input)).toBe(expected);
  });
});

describe("summariseBackup", () => {
  it("names failed and skipped counts, and nothing when both are zero", () => {
    expect(summariseBackup(null)).toBeNull();
    expect(summariseBackup({ error: 0, skipped: 0 })).toBeNull();
    expect(summariseBackup({ error: 1, skipped: 0 })).toBe("1 failed");
    expect(summariseBackup({ error: 0, skipped: 2 })).toBe("2 skipped");
    expect(summariseBackup({ error: 3, skipped: 1 })).toBe("3 failed · 1 skipped");
  });
});

describe("diagnosticsRows", () => {
  it("labels the id Error reference, skips empty rows, never names the vendor", () => {
    const rows = diagnosticsRows(collectMobileDiagnostics({ ...FACTS, workspaceId: null, backup: null }, { errorRef: "evt_9" }, 1));
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["App", "System", "Language", "Device", "Error reference"]));
    expect(labels).not.toContain("Workspace");
    expect(labels).not.toContain("Backup");
    expect(rows.find((r) => r.label === "Error reference")?.value).toBe("evt_9");
    expect(rows.find((r) => r.label === "Language")?.value).toBe("en-GB");
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("sentry");
  });
});
