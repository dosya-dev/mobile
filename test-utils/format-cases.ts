/**
 * The English output table for the shared formatting helpers (Task 4 of the
 * mobile i18n wiring). The cases are plain functions of fixed inputs; the
 * expected strings live in src/lib/format-helpers.i18n.test.tsx and were
 * captured from the helpers BEFORE they were translated, so "English is
 * byte-identical" is asserted rather than hoped for.
 *
 * Dates are built from local calendar fields, so the table does not depend on
 * the machine's time zone.
 */
import { formatBytes as libBytes, formatDuration as libDuration, formatSpeed, formatWhen } from "../src/lib/format";
import {
  formatBytes as fileBytes, formatDate, formatDateTime, kindLabel,
} from "../src/files/format";
import { roleLabel, timeAgo } from "../src/files/workspace-format";
import {
  badgesFor, expiryLabel, expiryShort, statusLabel, summarySentence,
} from "../src/share/format";
import { EXPIRY_CHOICES, choicesForDefault, choicesForExisting } from "../src/share/expiry";
import { monthLabel, weekdayInitials } from "../src/share/calendar";
import { classifyDeleteError, describeBlocker, formatScheduledDate } from "../src/account/deletion";
import { coverageScope, coverageWarning, formatDay } from "../src/backup/ui/coverageScope";
import { groupByDay as inboxGroups, relativeTime } from "../src/notifications/inbox";
import { dayLabel } from "../src/comments/thread";
import type { BackupFilters } from "../src/backup/filters";
import type { InboxItem } from "../src/notifications/inbox";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

export const D1 = new Date(2025, 6, 10, 15, 45, 0);
export const D1_UNIX = Math.floor(D1.getTime() / 1000);
export const NOW = Math.floor(new Date(2025, 6, 10, 12, 0, 0).getTime() / 1000);
const DAY = 86400;

const filters = (over: Partial<BackupFilters>): BackupFilters => ({
  mediaTypes: ["photo", "video"], albumMode: "all", albumIds: [], dateFloor: null, maxBytes: null, ...over,
});
const FLOOR = D1_UNIX;

const link = (over: Record<string, unknown>) => ({
  is_revoked: 0, expires_at: null, revoked_at: null, ...over,
}) as Parameters<typeof expiryLabel>[0];

const analytics = (over: { revoked?: boolean; status?: string; access?: string; people: number; downloads?: number }) =>
  ({
    link: { is_revoked: over.revoked ?? false, status: over.status ?? "active", access_mode: over.access ?? "public", download_count: over.downloads ?? 0 },
    reach: { visitors: over.people },
  }) as unknown as Parameters<typeof summarySentence>[0];

const item = (created_at: number) => ({ created_at }) as InboxItem;

const EXTS = [
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "svg", "tiff", "tif", "dng", "avif", "bmp",
  "mp4", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "mka",
  "pdf", "epub", "mobi", "azw", "azw3", "cbz", "fb2", "md", "markdown", "txt", "log", "csv", "tsv", "json",
  "xml", "yml", "yaml", "sql", "srt", "vtt", "ass", "ssa", "zip", "rar", "7z", "tar", "gz", "doc", "docx",
  "xls", "xlsx", "ppt", "pptx", "vcf", ".JPG",
];

export type Case = [name: string, run: () => unknown];

export const CASES: Case[] = [
  // src/lib/format.ts
  ...[0, 1, 512, 1023, 1024, 1536, MB, 5 * MB, 1.5 * GB, 3 * TB, 1.25 * TB, NaN, -5, 1500.6, Infinity].map(
    (n): Case => [`lib.formatBytes(${n})`, () => libBytes(n)]),
  ["lib.formatSpeed(MB)", () => formatSpeed(MB)],
  ["lib.formatSpeed(1536)", () => formatSpeed(1536)],
  ...[null, 0, NaN, -3, 0.2, 5, 59, 60, 90, 3599, 3600, 3720, 7322].map(
    (n): Case => [`lib.formatDuration(${n})`, () => libDuration(n)]),
  ["lib.formatWhen", () => formatWhen(D1_UNIX)],
  // src/files/format.ts
  ...[0, -1, 1, 1023, 1023.9, 1024, 1536, 3.3 * MB, 5 * GB, 1.5 * TB, 2000 * TB].map(
    (n): Case => [`files.formatBytes(${n})`, () => fileBytes(n)]),
  ["files.formatDate", () => formatDate(D1_UNIX)],
  ["files.formatDateTime", () => formatDateTime(D1_UNIX)],
  ...EXTS.map((e): Case => [`files.kindLabel(.${e})`, () => kindLabel("application/octet-stream", e)]),
  ["files.kindLabel(unknown ext)", () => kindLabel("application/octet-stream", ".xyz")],
  ["files.kindLabel(image mime)", () => kindLabel("image/x-foo", null)],
  ["files.kindLabel(video mime)", () => kindLabel("video/x-foo", null)],
  ["files.kindLabel(audio mime)", () => kindLabel("audio/x-foo", null)],
  ["files.kindLabel(text mime)", () => kindLabel("text/x-foo", null)],
  ["files.kindLabel(book mime)", () => kindLabel("application/epub+zip", null)],
  ["files.kindLabel(other)", () => kindLabel("application/octet-stream", null)],
  // src/files/workspace-format.ts
  ...["role_owner", "role_admin", "role_member", "role_viewer", "role_a1b2c3"].map(
    (r): Case => [`ws.roleLabel(${r})`, () => roleLabel(r)]),
  ...[0, 59, 60, 119, 3599, 3600, 7200, 86399, DAY, 2 * DAY, 29 * DAY, 30 * DAY, 59 * DAY, 60 * DAY, 364 * DAY, 365 * DAY, 800 * DAY].map(
    (d): Case => [`ws.timeAgo(${d})`, () => timeAgo(NOW - d, NOW)]),
  ["ws.timeAgo(future)", () => timeAgo(NOW + 500, NOW)],
  // src/share/format.ts
  ...["active", "expiring", "expired", "revoked"].map((s): Case => [`share.statusLabel(${s})`, () => statusLabel(s as never)]),
  ...([
    ["revoked", { is_revoked: 1, expires_at: NOW + 9999 }],
    ["never", {}],
    ["past", { expires_at: NOW - 5 }],
    ["zero", { expires_at: NOW }],
    ["30s", { expires_at: NOW + 30 }],
    ["3599s", { expires_at: NOW + 3599 }],
    ["3600s", { expires_at: NOW + 3600 }],
    ["5400s", { expires_at: NOW + 5400 }],
    ["2h", { expires_at: NOW + 7200 }],
    ["23.6h", { expires_at: NOW + 85000 }],
    ["86399s", { expires_at: NOW + 86399 }],
    ["1d", { expires_at: NOW + DAY }],
    ["30h", { expires_at: NOW + 30 * 3600 }],
    ["47h", { expires_at: NOW + 47 * 3600 }],
    ["2d", { expires_at: NOW + 2 * DAY }],
    ["6d", { expires_at: NOW + 6 * DAY + 5 }],
    ["1500d", { expires_at: NOW + 1500 * DAY }],
  ] as [string, Record<string, unknown>][]).flatMap(([n, l]): Case[] => [
    [`share.expiryLabel(${n})`, () => expiryLabel(link(l), NOW)],
    [`share.expiryShort(${n})`, () => expiryShort(link(l), NOW)],
  ]),
  ["share.badges(all)", () => badgesFor({ is_password_protected: 1, lock_mode: "view_only", access_mode: "restricted", recipient_count: 3 })],
  ["share.badges(full_lock)", () => badgesFor({ is_password_protected: 0, lock_mode: "full_lock", access_mode: "public", recipient_count: 0 })],
  ["share.badges(none)", () => badgesFor({ is_password_protected: 0, lock_mode: "none", access_mode: "public", recipient_count: 0 } as never)],
  ["share.summary(revoked 0)", () => summarySentence(analytics({ revoked: true, people: 0 }))],
  ["share.summary(revoked 1)", () => summarySentence(analytics({ revoked: true, people: 1 }))],
  ["share.summary(revoked 5)", () => summarySentence(analytics({ revoked: true, people: 5 }))],
  ["share.summary(expired 0)", () => summarySentence(analytics({ status: "expired", people: 0 }))],
  ["share.summary(active 0)", () => summarySentence(analytics({ people: 0 }))],
  ["share.summary(public 1/1)", () => summarySentence(analytics({ people: 1, downloads: 1 }))],
  ["share.summary(public 3/0)", () => summarySentence(analytics({ people: 3, downloads: 0 }))],
  ["share.summary(public 1200/2500)", () => summarySentence(analytics({ people: 1200, downloads: 2500 }))],
  ["share.summary(restricted 1/1)", () => summarySentence(analytics({ access: "restricted", people: 1, downloads: 1 }))],
  ["share.summary(restricted 4/7)", () => summarySentence(analytics({ access: "restricted", people: 4, downloads: 7 }))],
  // src/share/expiry.ts
  ["expiry.choices", () => EXPIRY_CHOICES.map((c) => c.label)],
  ["expiry.default(14)", () => choicesForDefault(14).choices.map((c) => c.label)],
  ["expiry.default(null)", () => choicesForDefault(null).choices.map((c) => c.label)],
  ["expiry.existing(null)", () => choicesForExisting(null, NOW).choices.map((c) => c.label)],
  ["expiry.existing(40d)", () => choicesForExisting(NOW + 40 * DAY, NOW).choices.map((c) => c.label)],
  ["expiry.existing(1d)", () => choicesForExisting(NOW + DAY - 100, NOW).choices.map((c) => c.label)],
  // src/share/calendar.ts
  ["cal.monthLabel", () => monthLabel(D1.getTime())],
  ["cal.weekdayInitials", () => weekdayInitials()],
  // src/account/deletion.ts
  ["del.blocker(1)", () => describeBlocker({ kind: "workspace_has_members", workspace_id: "w", workspace_name: "Team A", member_count: 1 })],
  ["del.blocker(3)", () => describeBlocker({ kind: "workspace_has_members", workspace_id: "w", workspace_name: "Team A", member_count: 3 })],
  ["del.scheduled", () => formatScheduledDate(D1_UNIX)],
  ["del.err429burned", () => classifyDeleteError({ status: 429, message: "Please request a new code" })],
  ["del.err429", () => classifyDeleteError({ status: 429, message: "slow down" })],
  ["del.err403pw", () => classifyDeleteError({ status: 403, message: "Wrong password" })],
  ["del.err400blocked", () => classifyDeleteError({ status: 400, message: "Transfer ownership first" })],
  ["del.err400nopw", () => classifyDeleteError({ status: 400, message: "This account has no password" })],
  ["del.err400", () => classifyDeleteError({ status: 400, message: "bad" })],
  ["del.unknown", () => classifyDeleteError(new Error("   "))],
  ["del.unknownRaw", () => classifyDeleteError(new Error("Boom"))],
  // src/backup/ui/coverageScope.ts
  ["cov.formatDay", () => formatDay(D1_UNIX)],
  ["cov.scope(photos)", () => coverageScope(filters({ mediaTypes: ["photo"] }), 10, 5)],
  ["cov.scope(videos)", () => coverageScope(filters({ mediaTypes: ["video"] }), 10, 5)],
  ["cov.scope(1 folder)", () => coverageScope(filters({ albumMode: "include", albumIds: ["a"] }), null, null)],
  ["cov.scope(3 folders)", () => coverageScope(filters({ albumMode: "include", albumIds: ["a", "b", "c"] }), null, null)],
  ["cov.scope(date)", () => coverageScope(filters({ dateFloor: FLOOR }), 10, 5)],
  ["cov.scope(photos+folders+date)", () => coverageScope(filters({ mediaTypes: ["photo"], albumMode: "include", albumIds: ["a", "b"], dateFloor: FLOOR }), null, null)],
  ["cov.scope(videos+date)", () => coverageScope(filters({ mediaTypes: ["video"], dateFloor: FLOOR }), null, null)],
  ["cov.scope(folders+date)", () => coverageScope(filters({ albumMode: "include", albumIds: ["a"], dateFloor: FLOOR }), null, null)],
  ["cov.scope(excluded)", () => coverageScope(filters({}), 100, 58)],
  ["cov.scope(excluded 1234)", () => coverageScope(filters({}), 2000, 766)],
  ["cov.scope(none)", () => coverageScope(filters({}), 100, 100)],
  ["cov.warn(none)", () => coverageWarning(filters({}), 100, 100)],
  ["cov.warn(date)", () => coverageWarning(filters({ dateFloor: FLOOR }), 1500, 300)],
  ["cov.warn(1 folder)", () => coverageWarning(filters({ albumMode: "include", albumIds: ["a"] }), 100, 60)],
  ["cov.warn(2 folders)", () => coverageWarning(filters({ albumMode: "include", albumIds: ["a", "b"] }), 100, 60)],
  ["cov.warn(photos only)", () => coverageWarning(filters({ mediaTypes: ["photo"] }), 100, 60)],
  ["cov.warn(videos only)", () => coverageWarning(filters({ mediaTypes: ["video"] }), 100, 60)],
  ["cov.warn(photos+date)", () => coverageWarning(filters({ mediaTypes: ["photo"], dateFloor: FLOOR }), 100, 60)],
  ["cov.warn(folders+date)", () => coverageWarning(filters({ albumMode: "include", albumIds: ["a", "b", "c"], dateFloor: FLOOR }), 100, 60)],
  ["cov.warn(all three)", () => coverageWarning(filters({ mediaTypes: ["video"], albumMode: "include", albumIds: ["a"], dateFloor: FLOOR }), 5000, 100)],
  ["cov.warn(unexplained)", () => coverageWarning(filters({ maxBytes: 5 }), 100, 60)],
  // src/notifications/inbox.ts
  ...[0, 1, 59, 60, 119, 3599, 3600, 86399, DAY, 1500 * DAY, -50].map(
    (s): Case => [`inbox.relativeTime(${s})`, () => relativeTime(NOW - s, NOW)]),
  ["inbox.groups", () => inboxGroups([item(NOW), item(NOW - 5 * DAY)], NOW).map((g) => g.label)],
  ["inbox.groups(today)", () => inboxGroups([item(NOW)], NOW).map((g) => g.label)],
  // src/comments/thread.ts
  ["thread.today", () => dayLabel(NOW, NOW)],
  ["thread.yesterday", () => dayLabel(NOW - DAY, NOW)],
  ["thread.older", () => dayLabel(NOW - 40 * DAY, NOW)],
  ["thread.oldest", () => dayLabel(D1_UNIX - 700 * DAY, NOW)],
];
