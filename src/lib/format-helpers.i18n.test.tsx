/**
 * Task 4: the shared helpers return text in the language current at call time,
 * and their English output is the same as before they were translated.
 */
import { CASES, D1, D1_UNIX, NOW } from "../../test-utils/format-cases";
import expected from "../../test-utils/format-cases.en.json";
import { renderInLocale } from "../../test-utils/i18n-sweep";
import { Text, View } from "react-native";
import { __resetI18nForTests } from "./i18n";
import { formatBytes as libBytes, formatDuration, formatWhen } from "./format";
import { formatBytes as fileBytes, formatDate, kindLabel } from "@/files/format";
import { roleLabel, timeAgo } from "@/files/workspace-format";
import { expiryLabel, expiryShort, statusLabel, summarySentence } from "@/share/format";
import { EXPIRY_CHOICES, NEVER, choicesForDefault } from "@/share/expiry";
import { monthLabel, weekdayInitials } from "@/share/calendar";
import { classifyDeleteError, describeBlocker, formatScheduledDate } from "@/account/deletion";
import { coverageScope, coverageWarning } from "@/backup/ui/coverageScope";
import { groupByDay, relativeTime } from "@/notifications/inbox";
import { dayLabel } from "@/comments/thread";
import { apiRequest } from "@/api/client";
import { ApiError } from "@/api/errors";

jest.mock("@/ui/maintenanceStore", () => ({ useMaintenanceStore: { getState: () => ({ set: jest.fn() }) } }));

const MB = 1024 * 1024;
const DAY = 86400;
const expect_ = expected as Record<string, unknown>;
/** The catalogs use no-break spaces before units (correct typography); compare with plain ones. */
const sp = (s: string): string => s.replace(/\u00a0/g, " ");

afterEach(() => {
  __resetI18nForTests();
});

describe("English output is unchanged (table captured before the helpers were translated)", () => {
  it("covers every case in the table", () => {
    expect(CASES.map(([n]) => n).sort()).toEqual(Object.keys(expect_).sort());
  });
  it.each(CASES)("%s", (name, run) => {
    expect(run()).toEqual(expect_[name]);
  });
});

describe("the helpers follow the language current at call time", () => {
  it("formatBytes: de uses the decimal comma, fr the octet units", async () => {
    await renderInLocale(<></>, "de");
    expect(sp(libBytes(1536))).toBe("1,5 KB");
    expect(sp(fileBytes(1536))).toBe("1,5 KB");
    expect(sp(libBytes(3 * 1024 ** 4))).toBe("3,00 TB");
    await renderInLocale(<></>, "fr");
    expect(sp(libBytes(1536))).toBe("1,5 Ko");
    expect(sp(fileBytes(0))).toBe("0 o");
    expect(sp(libBytes(512))).toBe("512 o");
  });

  it("switching tr then de between two calls changes the text each time", async () => {
    await renderInLocale(<></>, "tr");
    const tr = [roleLabel("role_owner"), expiryShort({ is_revoked: 0, expires_at: null, revoked_at: null }, NOW), sp(relativeTime(NOW - 120, NOW))];
    expect(tr).toEqual(["Sahip", "Süresiz", "2 dk."]);
    await renderInLocale(<></>, "de");
    const de = [roleLabel("role_owner"), expiryShort({ is_revoked: 0, expires_at: null, revoked_at: null }, NOW), sp(relativeTime(NOW - 120, NOW))];
    expect(de[0]).toBe("Inhaber");
    expect(de[2]).toBe("2 Min.");
    expect(de).not.toEqual(tr);
  });

  it("calendar: weekday initials, month and dates are Turkish in tr", async () => {
    await renderInLocale(<></>, "tr");
    expect(weekdayInitials()).toEqual(["P", "P", "S", "Ç", "P", "C", "C"]);
    expect(monthLabel(D1.getTime())).toBe("Temmuz 2025");
    expect(formatScheduledDate(D1_UNIX)).toBe("10 Temmuz 2025");
    expect(formatDate(D1_UNIX)).toMatch(/Tem/);
  });

  it("thread dates keep en-US only in English", async () => {
    expect(dayLabel(NOW - 40 * DAY, NOW)).toBe("May 31, 2025");
    await renderInLocale(<></>, "tr");
    expect(dayLabel(NOW - 40 * DAY, NOW)).toBe("31 Mayıs 2025");
    expect(dayLabel(NOW - DAY, NOW)).toBe("Dün");
    expect(dayLabel(NOW, NOW)).toBe("Bugün");
  });

  it("sentences take values and pluralise in the language", async () => {
    await renderInLocale(<></>, "de");
    expect(describeBlocker({ kind: "workspace_has_members", workspace_id: "w", workspace_name: "Team A", member_count: 3 })).toContain("3 weitere Mitglieder");
    expect(describeBlocker({ kind: "workspace_has_members", workspace_id: "w", workspace_name: "Team A", member_count: 1 })).toContain("1 weiteres Mitglied");
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe("vor 3 Tagen");
    expect(timeAgo(NOW - 1 * DAY, NOW)).toBe("vor 1 Tag");
    expect(expiryLabel({ is_revoked: 0, expires_at: NOW + 3 * DAY + 5, revoked_at: null }, NOW)).toBe("Noch 3 Tage");
  });

  it("choice labels are read at render, so a held list follows a switch", async () => {
    const held = choicesForDefault(14).choices;
    expect(held.map((c) => c.label)).toContain("14 days");
    await renderInLocale(<></>, "de");
    expect(NEVER.label).not.toBe("Never");
    expect(held.map((c) => c.label)).not.toContain("14 days");
    expect(EXPIRY_CHOICES.map((c) => c.label)).not.toContain("1 hour");
    await renderInLocale(<></>, "tr");
    expect(NEVER.label).toBe("Süresiz");
    expect(held.find((c) => c.key === "ws-14")?.label).toBe("14 gün");
  });

  it("every helper that returns a sentence leaves no English behind in tr", async () => {
    await renderInLocale(<></>, "tr");
    const texts = [
      libBytes(2 * MB), formatDuration(3720), formatWhen(D1_UNIX), kindLabel("x", "jpg"), kindLabel("application/pdf", ".docx"),
      kindLabel("x/y", null), roleLabel("role_x"), timeAgo(NOW - 5 * DAY, NOW), statusLabel("expiring"),
      expiryLabel({ is_revoked: 1, expires_at: null, revoked_at: null }, NOW),
      expiryLabel({ is_revoked: 0, expires_at: NOW + 7200, revoked_at: null }, NOW),
      summarySentence({ link: { is_revoked: false, status: "active", access_mode: "public", download_count: 2 }, reach: { visitors: 3 } } as never),
      classifyDeleteError({ status: 429, message: "x" }).message, classifyDeleteError({ status: 400, message: "bad" }).message,
      groupByDay_labels(),
      coverageScope({ mediaTypes: ["photo"], albumMode: "include", albumIds: ["a"], dateFloor: D1_UNIX, maxBytes: null }, null, null) ?? "",
      coverageWarning({ mediaTypes: ["photo", "video"], albumMode: "include", albumIds: ["a"], dateFloor: null, maxBytes: null }, 100, 60)?.title ?? "",
      coverageWarning({ mediaTypes: ["photo", "video"], albumMode: "all", albumIds: [], dateFloor: null, maxBytes: null }, 100, 60)?.detail ?? "",
    ];
    // The sweep's strict matcher reads the rendered texts back.
    const r = await renderInLocale(<View>{texts.filter(Boolean).map((x, i) => <Text key={i}>{x}</Text>)}</View>, "tr");
    expect(r.leftover({ allow: ["PDF", "JSON"] })).toEqual([]);
  });

  it("the narrowing phrase is built by the language's own message", async () => {
    const f = { mediaTypes: ["photo"] as ("photo" | "video")[], albumMode: "include" as const, albumIds: ["a", "b"], dateFloor: D1_UNIX, maxBytes: null };
    await renderInLocale(<></>, "de");
    expect(coverageScope(f, null, null)).toMatch(/^Nur Fotos, 2 Ordner, seit /);
    await renderInLocale(<></>, "fr");
    expect(coverageScope(f, null, null)).toMatch(/^Photos seules · 2 dossiers · dès /);
  });

  it("plain counts are not grouped in English but are in other languages", async () => {
    const f = { mediaTypes: ["photo", "video"] as ("photo" | "video")[], albumMode: "all" as const, albumIds: [], dateFloor: null, maxBytes: null };
    expect(coverageScope(f, 2000, 766)).toBe("1234 more on this phone not included");
    await renderInLocale(<></>, "de");
    expect(coverageScope(f, 2000, 766)).toContain("1.234");
  });
});

function groupByDay_labels(): string {
  return groupByDay([{ created_at: NOW } as never, { created_at: NOW - 5 * DAY } as never], NOW).map((g) => g.label).join(" ");
}

describe("api/client local fallback texts", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const reply = (over: Partial<Response> & { json?: () => Promise<unknown> }) =>
    (global.fetch = jest.fn().mockResolvedValue({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ ok: true }), ...over }));

  it("English", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    await expect(apiRequest("/x")).rejects.toMatchObject({ message: "Network request failed", status: 0 });
    reply({ json: async () => { throw new Error("bad json"); } });
    await expect(apiRequest("/x")).rejects.toMatchObject({ message: "Malformed server response" });
    reply({ status: 500, ok: false, json: async () => ({}) });
    await expect(apiRequest("/x")).rejects.toMatchObject({ message: "Request failed (500)" });
    reply({ status: 500, ok: false, json: async () => ({ error: "Server said so" }) });
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/x")).rejects.toMatchObject({ message: "Server said so" });
  });

  it("Turkish, and the status stays unformatted", async () => {
    await renderInLocale(<></>, "tr");
    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    await expect(apiRequest("/x")).rejects.toMatchObject({ message: "Ağ isteği gönderilemedi." });
    reply({ status: 500, ok: false, json: async () => ({}) });
    await expect(apiRequest("/x")).rejects.toMatchObject({ message: "İstek tamamlanamadı (500)." });
  });
});
