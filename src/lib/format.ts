// Byte / speed / duration formatting for the upload UI. formatBytes mirrors
// packages/shared/src/constants.ts (mobile is decoupled from @dosya-dev/shared).
import { fixedNumber, formatDateWith, localDigits } from "@/lib/format-locale";
import { t } from "@/lib/i18n";

const MB = 1_048_576;
/** One binary gigabyte; family reservations are whole GB of this. */
export const GB = 1_073_741_824;
const TB = 1_099_511_627_776;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  // fixedNumber is toFixed in English and the language's own separator
  // elsewhere; a plain byte count is a string so it is never grouped.
  if (bytes < 1024) return t("common.label.bytesB", { bytes: localDigits(Math.round(bytes)) });
  if (bytes < MB) return t("common.label.sizeKB", { size: fixedNumber(bytes / 1024, 1) });
  if (bytes < GB) return t("common.label.sizeMB", { size: fixedNumber(bytes / MB, 1) });
  if (bytes < TB) return t("common.label.sizeGB", { size: fixedNumber(bytes / GB, 1) });
  return t("common.label.sizeTB", { size: fixedNumber(bytes / TB, 2) });
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "-";
  const s = Math.ceil(seconds);
  if (s < 60) return t("common.label.secondsS", { seconds: localDigits(s) });
  const m = Math.floor(s / 60);
  if (m < 60) return t("common.label.minutesM", { minutes: localDigits(m) });
  const h = Math.floor(m / 60);
  return t("common.label.hoursHMinutesM", { hours: localDigits(h), minutes: localDigits(m % 60) });
}

// Date + short time (e.g. "Jul 10, 3:45 PM") so multiple same-day runs are
// distinguishable. Shared by the Backup status strip and activity feed.
export function formatWhen(unixSeconds: number): string {
  return formatDateWith(unixSeconds, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Elapsed run clock, always HH:MM:SS (e.g. "00:10:32").
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
