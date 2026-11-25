import { t } from "@/lib/i18n";
import type { FileDetail } from "@/files/types";
import { canDownload, isViewOnly, needsUnlock } from "@/files/lock";
import { fileKind, formatBytes, formatDate, formatDuration, isArchiveName, kindLabel, normalizeExt, readerType } from "@/files/format";
import { localDigits } from "@/lib/format-locale";

/**
 * Every decision the viewer makes about a file, in one pure module.
 *
 * The screen this replaces made all of them inline, as a nine-branch ternary
 * chain inside JSX, which is why a .vcf rendered raw "BEGIN:VCARD" source for
 * as long as it did: the branch that would have caught it sat below the
 * text branch and was unreachable. Deciding here means the branches are
 * ordered once, in one readable place, and can be tested without mounting a
 * component or a native module.
 */

export type StageKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "csv"
  | "markdown"
  | "contacts"
  | "calendar"
  | "book"
  | "office"
  | "locked"
  | "error"
  | "too-large"
  | "none";

export interface StageInput {
  file: FileDetail;
  /** A full_lock file with no unlock token yet. */
  gated: boolean;
  /** The preview bytes did not arrive. */
  failed: boolean;
  /** A text body over the inline preview cap. */
  textTooLarge: boolean;
  /** A .vcf small enough to parse on the JS thread. */
  isContacts: boolean;
  /** A .ics whose fetched body parsed to at least one event, or one over the text cap the route reads instead. */
  isCalendar?: boolean;
}

/**
 * Which stage renders the file.
 *
 * Order matters and is deliberate:
 *  1. `locked` wins over everything - there are no bytes to show yet.
 *  2. `error` next, so a failed fetch never falls through to a stage that
 *     would render an empty box and look like a successful empty file.
 *  3. `contacts` BEFORE `text`. A .vcf is text/vcard, so a kind check alone
 *     sends it to the text stage and shows the user vCard source. `calendar`
 *     likewise for a .ics (text/calendar); one with no events stays text.
 *  4. `too-large` only applies to the text family, the only stages that read
 *     the whole body into JS - and it outranks csv/markdown, whose parsers
 *     never see a body the preview refused to fetch.
 *  5. `csv` and `markdown` are text with a better shape available. They ride
 *     the same body fetch; their stages fall back to the plain text card for
 *     degenerate content, so the split costs nothing when wrong.
 */
export function stageKind(input: StageInput): StageKind {
  const { file, gated, failed, textTooLarge, isContacts, isCalendar } = input;
  if (gated) return "locked";
  if (failed) return "error";

  const kind = fileKind(file.mime_type, file.extension);
  if (isContacts) return "contacts";
  if (isCalendar) return "calendar";
  if (kind === "text") {
    if (textTooLarge) return "too-large";
    const e = normalizeExt(file.extension);
    if (e === "csv" || e === "tsv") return "csv";
    if (e === "md" || e === "markdown") return "markdown";
    return "text";
  }
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "pdf") return "pdf";
  if (kind === "office") return "office";
  if (kind === "book") return "book";
  return "none";
}

export type PrimaryActionKind = "read" | "play" | "contacts" | "calendar" | "save" | "retry" | "browse";
export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  /** Filled buttons for a real destination; quiet ones for a fallback. */
  tone: "solid" | "quiet";
}

export interface PrimaryInput {
  file: FileDetail;
  stage: StageKind;
  /** Contacts parsed out of a .vcf, when the body was small enough to count. */
  contactCount?: number | null;
  /** Saved reading progress, 0-1. */
  readPercent?: number | null;
  /**
   * How this device can actually play this audio file. "queue" is the normal
   * hand-off to the real player; "inline" means only the on-stage transport
   * can decode it (libVLC for OGG/Opus/WMA on iOS), so a Play button that
   * jumps to the queue would produce silence; "none" means nothing on this
   * phone decodes it at all, and Save is the only honest offer.
   */
  audioPlayback?: "queue" | "inline" | "none";
}

/**
 * The one action most likely wanted, shown above the icon row.
 *
 * Returns null when the icon row already covers everything - an image has
 * nowhere better to be, so it gets no button at all rather than a button that
 * repeats Save.
 */
export function primaryAction(input: PrimaryInput): PrimaryAction | null {
  const { file, stage, contactCount, readPercent, audioPlayback = "queue" } = input;

  if (stage === "error") return { kind: "retry", label: t("common.action.tryAgain"), tone: "quiet" };
  if (stage === "locked") return null;

  if (stage === "book") {
    const started = (readPercent ?? 0) > 0;
    return { kind: "read", label: started ? t("files.action.continueReading") : t("files.action.read"), tone: "solid" };
  }
  if (stage === "pdf") return { kind: "read", label: t("files.action.read"), tone: "solid" };
  if (stage === "contacts") {
    return {
      kind: "contacts",
      label: contactCount ? t("files.action.viewContactCountPluralOneContactOtherContacts", { contactCount }) : t("files.action.viewContacts"),
      tone: "solid",
    };
  }
  if (stage === "calendar") return { kind: "calendar", label: t("files.open"), tone: "solid" };
  // Locked audio has no player queue entry (buildTracks filters lock_mode
  // !== "none" out), so it plays inline on the stage and needs no hand-off.
  // "inline" audio (a format only the on-stage libVLC transport decodes)
  // gets no button either - the transport is right there, and a Play that
  // jumps to the queue would produce silence. "none" falls through to Save.
  if (stage === "audio" && file.lock_mode === "none" && audioPlayback === "queue") {
    return { kind: "play", label: t("common.accessibility.play"), tone: "solid" };
  }
  if (stage === "text" && readerType(file.mime_type, file.extension) === "txt") {
    return { kind: "read", label: t("files.action.read"), tone: "solid" };
  }

  // A zip gets its own destination rather than falling into the generic
  // "nothing to open, offer Save" branch below. The archive endpoints ignore
  // the file's OWN lock the same way every other preview route does (the
  // server resolves them with allowViewOnlyFolders/ignoreOwnFileLock) - only a
  // gated full_lock file (no unlock token yet) is blocked, and that already
  // returned null above via the "locked" stage before this line runs.
  if (isArchiveName(file.name)) {
    return { kind: "browse", label: t("files.action.browseContents"), tone: "solid" };
  }

  // Nothing to open: offer the only thing that helps, and only when the server
  // would actually allow it (a view-only download is refused before presigning).
  const audioDead = stage === "audio" && audioPlayback === "none";
  if ((stage === "none" || stage === "too-large" || audioDead) && canDownload(file)) {
    return { kind: "save", label: t("common.action.saveToPhone"), tone: "quiet" };
  }
  return null;
}

export interface ActionAvailability {
  save: boolean;
  link: boolean;
  star: boolean;
  versions: boolean;
  more: boolean;
}

/**
 * Which of the five icon actions can do anything right now.
 *
 * Unavailable actions are DIMMED rather than removed, so unlocking a file does
 * not reflow the row under the user's thumb. The three lock modes differ:
 * full_lock withholds the bytes until a password unlock, view_only withholds
 * only the download.
 */
export function actionAvailability(file: FileDetail, unlockToken: string | null | undefined): ActionAvailability {
  if (needsUnlock(file, unlockToken)) {
    return { save: false, link: false, star: true, versions: false, more: true };
  }
  return { save: canDownload(file), link: true, star: true, versions: true, more: true };
}

export interface MetaExtras {
  /** "4032 x 3024", once the image reports its natural size. */
  dimensions?: string | null;
  /** Seconds, from the video player or the audio metadata store. */
  durationSec?: number | null;
  pageCount?: number | null;
  lineCount?: number | null;
  contactCount?: number | null;
  /** Saved reading progress, 0-1. */
  readPercent?: number | null;
}

/**
 * The facts under the filename, in reading order: how big, what it is, what
 * this type in particular has, and when it arrived.
 *
 * Every part is a non-empty string, so the caller can join them with a
 * separator without ever producing a stray dot. Extras are dropped when
 * unknown rather than rendered as a placeholder - a dimension that has not
 * measured yet simply is not there, and appears when it resolves.
 */
export function metaParts(file: FileDetail, extras: MetaExtras = {}): string[] {
  const parts = [formatBytes(file.size_bytes), kindLabel(file.mime_type, file.extension)];

  if (extras.dimensions) parts.push(extras.dimensions);
  if (extras.durationSec != null && extras.durationSec > 0) parts.push(formatDuration(extras.durationSec));
  if (extras.pageCount != null && extras.pageCount > 0) {
    parts.push(t("files.label.pagecountPluralOnePageOtherPages", { pageCount: extras.pageCount }));
  }
  if (extras.lineCount != null && extras.lineCount > 0) {
    parts.push(t("files.label.linecountPluralOneLineOtherLines", { lineCount: extras.lineCount }));
  }
  if (extras.contactCount != null && extras.contactCount > 0) {
    parts.push(t("files.label.contactcountPluralOneContactOtherContacts", { contactCount: extras.contactCount }));
  }
  if (extras.readPercent != null && extras.readPercent > 0) {
    parts.push(t("files.label.percentRead", { percent: localDigits(Math.round(extras.readPercent * 100)) }));
  }

  parts.push(formatDate(file.created_at));
  return parts;
}

/**
 * The badge beside the filename, or null when the file is unrestricted.
 * Distinct from the dimmed actions: this says WHY they are dimmed.
 */
export function lockBadge(file: FileDetail, unlockToken: string | null | undefined): string | null {
  if (needsUnlock(file, unlockToken)) return t("files.status.locked");
  if (isViewOnly(file)) return t("common.status.viewOnly");
  return null;
}

export interface DetailRow {
  label: string;
  value: string;
}

/**
 * The pull-up details panel.
 *
 * Rows whose value is unknown are omitted entirely - the source rows differ in
 * how much they carry (a listing row has no uploader, a search hit has no
 * version), and printing "Unknown" for each absent column would turn the panel
 * into a list of things mobile does not know.
 */
export function detailRows(
  file: FileDetail,
  opts: { regionLabel?: string | null; formatWhen: (unix: number) => string } ,
): DetailRow[] {
  const rows: DetailRow[] = [
    { label: t("files.label.kind"), value: kindLabel(file.mime_type, file.extension) },
    { label: t("common.label.size"), value: formatBytes(file.size_bytes) },
    { label: t("files.label.added"), value: opts.formatWhen(file.created_at) },
  ];

  // Only when it differs: an unmodified file would otherwise print the same
  // timestamp twice, which reads as a bug rather than as information.
  if (file.updated_at && file.updated_at !== file.created_at) {
    rows.push({ label: t("common.label.modified"), value: opts.formatWhen(file.updated_at) });
  }
  if (file.uploader_name) rows.push({ label: t("files.label.addedBy"), value: file.uploader_name });
  if (opts.regionLabel) rows.push({ label: t("files.label.storedIn"), value: opts.regionLabel });
  if (file.current_version > 1) rows.push({ label: t("files.label.versionTitleCase"), value: `${file.current_version}` });
  if (file.share_count > 0) {
    rows.push({ label: t("files.label.links"), value: t("files.label.sharecountActive", { shareCount: localDigits(file.share_count) }) });
  }

  const ext = normalizeExt(file.extension);
  if (ext) rows.push({ label: t("files.label.extension"), value: `.${ext}` });

  return rows;
}
