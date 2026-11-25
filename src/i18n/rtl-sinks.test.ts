/**
 * Data that leaves the app never carries a bidi control. Display is isolated by
 * t(); the places a translated string can travel (Sentry, the report-problem
 * document, the local backup ledger) strip at the sink.
 */
const mockRun = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: (...a: unknown[]) => mockRun(...a),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
  })),
}));

import { scrubEvent } from "@/telemetry/sentry";
import { collectMobileDiagnostics } from "@/support/diagnostics";
import { __resetI18nForTests, stripBidi } from "@/lib/i18n";
import { bumpAttempts, setStatus } from "@/backup/ledger";

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const FSI = "\u2068";
const PDI = "\u2069";

afterEach(() => {
  __resetI18nForTests();
  mockRun.mockClear();
});

describe("stripBidi", () => {
  it("removes isolates, marks, embeddings and overrides", () => {
    expect(stripBidi(`${FSI}a${PDI}`)).toBe("a");
    expect(stripBidi("\u2066a\u2067b\u2068c\u2069\u200Ed\u200Fe\u202Af\u202Eg\u202C")).toBe("abcdefg");
  });
});

describe("Sentry scrubEvent", () => {
  it("strips bidi controls from message, exception values and breadcrumbs", () => {
    const event = scrubEvent({
      message: `Failed ${FSI}report (1).pdf${PDI}\u200F`,
      exception: { values: [{ type: "Error", value: `${FSI}a.zip${PDI} failed\u200E` }, { type: "Error" }] },
      breadcrumbs: [{ message: `${FSI}x${PDI}` }, { category: "nav" }],
    });
    expect(event.message).toBe("Failed report (1).pdf");
    expect(event.exception?.values?.[0]?.value).toBe("a.zip failed");
    expect(event.exception?.values?.[1]?.value).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.message).toBe("x");
    expect(JSON.stringify(event)).not.toMatch(BIDI);
  });

  it("strips them one level deep from breadcrumb data, extra and contexts, leaving other values alone", () => {
    const event = scrubEvent({
      breadcrumbs: [{ category: "console", data: { arguments: `${FSI}x${PDI}`, logger: "console", n: 3 } }],
      extra: { title: `\u200F${FSI}a.pdf${PDI}`, count: 2, nested: { keep: "as is" } },
      contexts: { screen: { name: `${FSI}y${PDI}`, width: 390 } },
    });
    expect(event.breadcrumbs?.[0]?.data).toEqual({ arguments: "x", logger: "console", n: 3 });
    expect(event.extra).toEqual({ title: "a.pdf", count: 2, nested: { keep: "as is" } });
    // contexts is a map of context objects, so their fields are the level scrubbed.
    expect(event.contexts).toEqual({ screen: { name: "y", width: 390 } });
  });

  it("leaves an event with none of those fields alone", () => {
    expect(scrubEvent({ user: { id: "u1", email: "a@b.c" } })).toEqual({ user: { id: "u1" } });
  });
});

describe("report-problem diagnostics", () => {
  const FACTS = {
    displayVersion: "1.0.4 (41)", build: "41", osName: "iOS", osVersion: "26.0", model: "iPhone",
    locale: "ar", workspaceId: "ws_1", backup: { error: 1, skipped: 0 },
  };

  it("contains no bidi control even when the inputs carry them", () => {
    const d = collectMobileDiagnostics(
      { ...FACTS, model: `${FSI}iPhone${PDI}`, locale: `ar\u200F` },
      { page: `/files/${FSI}x${PDI}`, errorRef: "evt", errorMessage: `${FSI}report (1).pdf${PDI} failed` },
      1,
    );
    expect(JSON.stringify(d)).not.toMatch(BIDI);
    expect(d.error_message).toBe("report (1).pdf failed");
  });
});

describe("backup ledger", () => {
  it("stores last_error without isolates", async () => {
    await setStatus("ws", "a", "error", { lastError: `${FSI}x.jpg${PDI} failed`, incAttempts: true });
    await bumpAttempts("ws", "a", `${FSI}y.jpg${PDI} failed`);
    const args = mockRun.mock.calls.flat().filter((v): v is string => typeof v === "string");
    expect(args.join("|")).not.toMatch(BIDI);
    expect(args).toContain("x.jpg failed");
    expect(args).toContain("y.jpg failed");
  });
});
