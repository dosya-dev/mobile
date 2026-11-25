import { t } from "@/lib/i18n";
import type { TrackMetadata } from "./metadata/metadataStore";
import type { PlayerTrack } from "./types";
import { localDigits } from "@/lib/format-locale";

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
    : `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Header stats: count always; total only once every track's duration is known. */
export function queueStats(queue: PlayerTrack[], entries: Record<string, TrackMetadata>): { count: number; totalLabel: string | null } {
  let total = 0;
  for (const track of queue) {
    const e = entries[track.fileId];
    if (!e || e.sizeBytes !== track.sizeBytes || e.modifiedAt !== track.modifiedAt || !e.durationSec) return { count: queue.length, totalLabel: null };
    total += e.durationSec;
  }
  if (queue.length === 0) return { count: 0, totalLabel: null };
  const mins = Math.round(total / 60);
  return { count: queue.length, totalLabel: mins >= 60 ? t("audio.label.hoursHMinutesMin", { hours: localDigits(Math.floor(mins / 60)), minutes: localDigits(mins % 60) }) : t("audio.label.minutesMin", { minutes: localDigits(mins) }) };
}
