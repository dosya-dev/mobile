import { t } from "@/lib/i18n";
import type { DownloadEntry } from "@/files/downloadModel";
import type { UploadItem } from "@/upload/types";
import { NO_VAULT_ACTIVITY, type VaultActivity } from "@/vault/status";
import { localDigits } from "@/lib/format-locale";

/**
 * What the orbit button is, at any moment, expressed as data.
 *
 * The button carries three jobs that used to own three separate surfaces - the
 * `+`, the transfer capsule and the mini player - so the only way to keep it
 * honest is to decide its whole appearance in one pure function and let the
 * component draw whatever comes back. Every rule about precedence lives here
 * and is tested without a renderer.
 */

/** What sits in the middle of the disc. The arcs are drawn around it. */
export type OrbitCore = "add" | "percent" | "artwork" | "close";

export interface OrbitInput {
  /** Every download the store knows about, finished ones included. */
  downloads: DownloadEntry[];
  uploads: UploadItem[];
  /** True when a queue is loaded - artwork may still be missing. */
  hasTrack: boolean;
  /** Seconds. Both zero when nothing has started playing yet. */
  position: number;
  duration: number;
  /**
   * The Vault's transfers, as counts and bytes. Never a name: the sheet is
   * reachable from the Files tab, outside the lock, so the Vault reports
   * itself as numbers and the names stay behind the unlock (vault/status.ts).
   */
  vault: VaultActivity;
  /** The sheet is open, so the button's job is to close it. */
  open: boolean;
}

export interface OrbitState {
  /** Outer arc, 0..1. Null draws no arc at all. */
  transfer: number | null;
  /** Capped at 99 for the same reason `DownloadRing` caps it: 100 belongs to done. */
  transferPct: number;
  /** Inner arc, 0..1. Null draws no arc at all. */
  playback: number | null;
  core: OrbitCore;
  /** How many transfers are moving or broken, for the sheet's heading. */
  transferCount: number;
  failedCount: number;
  label: string;
}

/** Downloads that have not finished, in the order the store holds them. */
export function liveDownloads(entries: DownloadEntry[]): DownloadEntry[] {
  return entries.filter((e) => e.phase !== "done");
}

/**
 * Uploads that still have something to say. An errored upload counts as
 * present, not finished - the dock's "2 failed" line was the only thing that
 * ever told anyone a batch had broken, and the sheet inherits that duty.
 */
export function liveUploads(items: UploadItem[]): UploadItem[] {
  return items.filter((i) => i.status === "uploading" || i.status === "queued" || i.status === "error");
}

/** Byte-weighted across both directions, so a big file counts for more. */
export function transferFraction(
  downs: DownloadEntry[],
  ups: UploadItem[],
  vault: VaultActivity = NO_VAULT_ACTIVITY,
): number | null {
  if (downs.length === 0 && ups.length === 0 && vault.count === 0) return null;
  const written =
    downs.reduce((n, e) => n + e.written, 0) +
    ups.reduce((n, i) => n + bytes(i) * clamp01(i.progress), 0) +
    vault.written;
  const total = downs.reduce((n, e) => n + e.total, 0) + ups.reduce((n, i) => n + bytes(i), 0) + vault.total;
  // A transfer whose total is not known yet is real and must still draw
  // something, so an unknown size reports zero progress rather than no arc.
  return total > 0 ? clamp01(written / total) : 0;
}

/**
 * Playback position as a fraction.
 *
 * A loaded queue that has not started, or a track whose duration the player has
 * not reported yet, gives a zero-length arc rather than none: the disc is
 * already wearing the artwork, and an arc that appears a second later reads as
 * a glitch.
 */
export function playbackFraction(hasTrack: boolean, position: number, duration: number): number | null {
  if (!hasTrack) return null;
  if (!(duration > 0)) return 0;
  return clamp01(position / duration);
}

export function orbitState(input: OrbitInput): OrbitState {
  const downs = liveDownloads(input.downloads);
  const ups = liveUploads(input.uploads);
  const transfer = transferFraction(downs, ups, input.vault);
  const playback = playbackFraction(input.hasTrack, input.position, input.duration);
  const transferCount = downs.length + ups.length + input.vault.count;
  const failedCount = ups.filter((i) => i.status === "error").length + input.vault.failed;

  // Precedence, and the one place it is decided. Artwork beats a percentage
  // because a percentage has the outer arc AND the sheet to report it, while a
  // track that is playing has nothing else on screen at all now that the mini
  // player is gone.
  const core: OrbitCore = input.open
    ? "close"
    : input.hasTrack
      ? "artwork"
      : transfer !== null
        ? "percent"
        : "add";

  return {
    transfer,
    transferPct: transfer === null ? 0 : Math.min(99, Math.round(transfer * 100)),
    playback,
    core,
    transferCount,
    failedCount,
    label: label(core, transferCount, failedCount),
  };
}

/**
 * The single line the Vault is allowed outside its own screens.
 *
 * A Vault transfer has a name, and the name is the one thing the Vault exists
 * to keep. So the sheet gets a count, a direction and a percentage, and the
 * row it draws is a door: the names, the per-file progress and Retry all live
 * inside the Vault, behind the unlock, where `TransferBar` already shows them.
 *
 * Null when the Vault is quiet, which is also the case where the row must not
 * render at all - an empty padlock line on the Files tab would announce that a
 * Vault exists to anyone holding the phone.
 */
export function vaultSummary(v: VaultActivity): { title: string; caption: string } | null {
  if (v.count === 0) return null;
  const title = t("navigation.heading.countPluralOneFileInYourVaultOtherFilesInYourVault", { count: v.count });
  if (v.failed > 0) {
    return {
      title,
      caption: t("navigation.error.countPluralOneFileOtherFilesCouldnTDirectionSelectDownloadDownloadUploadUpload", {
        count: v.failed,
        direction: brokeDoing(v),
      }),
    };
  }
  const pct = v.total > 0 ? Math.min(99, Math.round((v.written / v.total) * 100)) : 0;
  return { title, caption: doing(v, String(pct)) };
}

/**
 * Encryption is the slow half of a Vault upload and the half nobody expects,
 * so the line names it. A mixed batch says neither rather than the wrong one.
 */
function doing(v: VaultActivity, percent: string): string {
  if (v.uploads > 0 && v.downloads > 0) return t("navigation.label.transferringPercent", { percent });
  return v.downloads > 0
    ? t("navigation.label.downloadingAndDecryptingPercent", { percent })
    : t("navigation.label.encryptingAndUploadingPercent", { percent });
}

function brokeDoing(v: VaultActivity): string {
  if (v.uploads > 0 && v.downloads > 0) return "finish";
  return v.downloads > 0 ? "download" : "upload";
}

function label(core: OrbitCore, count: number, failed: number): string {
  if (core === "close") return t("common.close");
  if (core === "artwork") {
    return count > 0
      ? t("navigation.error.nowPlayingCountPluralOneTransferOtherTransfersHasFailuresSelectTrueFailedFailedOther", {
          count,
          hasFailures: failed > 0 ? "true" : "false",
          failed: localDigits(failed),
        })
      : t("navigation.label.nowPlaying");
  }
  if (core === "percent") return transfers(count, failed);
  return t("common.action.upload");
}

function transfers(count: number, failed: number): string {
  return failed > 0
    ? t("navigation.error.countPluralOneTransferOtherTransfersFailedFailed", { count, failed: localDigits(failed) })
    : t("navigation.label.countPluralOneTransferOtherTransfers", { count });
}

function bytes(i: UploadItem): number {
  return i.size > 0 ? i.size : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
