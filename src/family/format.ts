import { GB, formatBytes } from "@/lib/format";
import { formatNumberWith, localDigits, sizeUnits } from "@/lib/format-locale";
import { t } from "@/lib/i18n";

/** The unit the active language writes for a gigabyte ("GB", "Go" in French). */
export function gbUnit(): string {
  return sizeUnits().GB;
}

/**
 * The number part of formatGigabytes, without the unit: whole GB, grouped the
 * way the language groups ("1,234" in English). For "184 of 200 GB", so both
 * figures in one sentence agree.
 */
export function gigabyteFigure(bytes: number): string {
  return formatNumberWith(Math.round(Math.max(0, bytes) / GB), undefined, "en-US");
}

/** Whole GB ("1,234 GB"); under a gigabyte, the usual size ("512.0 MB"). Reservations are whole GB, so this is how they read. */
export function formatGigabytes(bytes: number): string {
  if (bytes < GB) return formatBytes(bytes);
  return t("common.label.sizeGB", { size: gigabyteFigure(bytes) });
}

/** Whole GB as a size; 0 stays "0 GB" (formatGigabytes would fall back to bytes). */
export function sizeGb(gb: number): string {
  return gb >= 1 ? formatGigabytes(gb * GB) : t("common.label.sizeGB", { size: localDigits(0) });
}
