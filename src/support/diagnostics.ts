// The mobile half of a bug report's diagnostics (spec:
// docs/superpowers/specs/2026-10-03-bug-report-design.md). Pure: every fact is
// passed in, so this runs under jest without Expo modules and the screen
// (app/report-problem.tsx) owns the reading.

import { t as moduleT, stripBidi } from "@/lib/i18n";
import type { T } from "@/i18n/translator";

export interface MobileDiagnostics {
  v: 1;
  client: "mobile";
  app_version: string;
  build: string | null;
  platform: string;
  locale: string | null;
  workspace_id: string | null;
  page: string | null;
  error_ref: string | null;
  error_message: string | null;
  extra: Record<string, string>;
  captured_at: number;
}

export interface MobileFacts {
  displayVersion: string | null;
  build: string | null;
  osName: string | null;
  osVersion: string | null;
  model: string | null;
  locale: string | null;
  workspaceId: string | null;
  backup: { error: number; skipped: number } | null;
}

/** The server cuts strings here too; cutting first keeps the document under
 *  its 8 KB gate whatever a message contains. */
export const DIAGNOSTICS_STRING_MAX = 300;

/**
 * Local paths and file URIs out, "<path>" in. An iOS sandbox path or an
 * Android storage path is where photo and cache file names live, and the
 * card promises nothing from the user's files is included.
 */
export function redactPaths(s: string): string {
  return s
    .replace(/file:\/\/[^\s"'`)]*/g, "<path>")
    .replace(/content:\/\/[^\s"'`)]*/g, "<path>")
    .replace(/\/(?:var\/mobile|private\/var|data\/user|data\/data|storage\/emulated|sdcard|Users|home)\/[^\s"'`)]*/g, "<path>")
    // The pass above stops at the first space, so a path with spaces in it
    // (an iOS display name like "My Document.pdf") leaves the rest of the
    // filename sitting right after "<path>". Clean up anything left that
    // still looks like the tail of a file name.
    .replace(/<path>[\w\-. ]*\.(?:jpe?g|png|heic|heif|gif|webp|mov|mp4|pdf|docx?|xlsx?|zip)\b/gi, "<path>");
}

function clean(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const out = stripBidi(redactPaths(v)).trim().slice(0, DIAGNOSTICS_STRING_MAX);
  return out.length > 0 ? out : null;
}

export function summariseBackup(b: { error: number; skipped: number } | null): string | null {
  if (!b) return null;
  const parts: string[] = [];
  if (b.error > 0) parts.push(`${b.error} failed`);
  if (b.skipped > 0) parts.push(`${b.skipped} skipped`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The Backup line as the card shows it, in the chosen language. The copy that
 * travels to support (summariseBackup, above) stays English on purpose.
 */
export function summariseBackupForDisplay(b: { error: number; skipped: number } | null, t: T = moduleT): string | null {
  if (!b || (b.error <= 0 && b.skipped <= 0)) return null;
  return t("report-problem.label.haserrorsSelectTrueFailedFailedHasSkippedSelectTrueSkippedSkippedOtherOtherSkippedSkipped", {
    hasErrors: String(b.error > 0),
    failed: b.error,
    hasSkipped: String(b.skipped > 0),
    skipped: b.skipped,
  });
}

export function collectMobileDiagnostics(
  facts: MobileFacts,
  prefill: { page?: string | null; errorRef?: string | null; errorMessage?: string | null },
  now: number = Math.floor(Date.now() / 1000),
): MobileDiagnostics {
  const extra: Record<string, string> = {};
  const model = clean(facts.model);
  if (model) extra.Device = model;
  const backup = summariseBackup(facts.backup);
  if (backup) extra.Backup = backup;
  const platform = clean(`${facts.osName ?? ""} ${facts.osVersion ?? ""}`) ?? "unknown";
  const page = clean(prefill.page);
  return {
    v: 1,
    client: "mobile",
    app_version: clean(facts.displayVersion) ?? "unknown",
    build: clean(facts.build),
    platform,
    locale: clean(facts.locale),
    workspace_id: clean(facts.workspaceId),
    page: page === null ? null : page.split(/[?#]/)[0],
    error_ref: clean(prefill.errorRef),
    error_message: clean(prefill.errorMessage),
    extra,
    captured_at: now,
  };
}

/**
 * The rows the card shows; empty values are left out; the id is "Error
 * reference", never the vendor's name. Labels (and the Backup summary, when the
 * backup counts are given) are in the chosen language; `d` itself, which is
 * what gets sent, stays English.
 */
export function diagnosticsRows(
  d: MobileDiagnostics,
  backup: { error: number; skipped: number } | null = null,
  t: T = moduleT,
): { label: string; value: string }[] {
  const extraLabel: Record<string, string> = {
    Device: t("common.label.device"),
    Backup: t("common.label.backup"),
  };
  // The payload says "unknown" in English; the card says it in the chosen language.
  const shown = (v: string): string => (v === "unknown" ? t("report-problem.label.unknown") : v);
  const rows: { label: string; value: string | null }[] = [
    { label: t("report-problem.label.app"), value: shown(d.app_version) },
    { label: t("report-problem.label.operatingSystem"), value: shown(d.platform) },
    { label: t("appearance.label.language"), value: d.locale },
    { label: t("common.label.workspace"), value: d.workspace_id },
    { label: t("report-problem.label.screen"), value: d.page },
    { label: t("report-problem.label.errorReference"), value: d.error_ref },
    { label: t("report-problem.label.diagnosticError"), value: d.error_message },
    ...Object.entries(d.extra).map(([label, value]) => ({
      label: extraLabel[label] ?? label,
      value: label === "Backup" ? summariseBackupForDisplay(backup, t) ?? value : value,
    })),
  ];
  return rows.filter((r): r is { label: string; value: string } => typeof r.value === "string" && r.value.length > 0);
}
