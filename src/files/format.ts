import type { MessageKey } from "@/i18n/keys";
import { fixedNumber, formatDateWith, localDigits } from "@/lib/format-locale";
import { t } from "@/lib/i18n";

const SIZE_KEYS: MessageKey[] = [
  "common.label.sizeKB",
  "common.label.sizeMB",
  "common.label.sizeGB",
  "common.label.sizeTB",
];

export function formatBytes(n: number): string {
  // NaN and Infinity used to print "NaN undefined"; they read as empty now.
  if (!Number.isFinite(n) || n <= 0) return t("common.label.0B");
  const i = Math.min(SIZE_KEYS.length, Math.max(0, Math.floor(Math.log(n) / Math.log(1024))));
  if (i === 0) return t("common.label.bytesB", { bytes: localDigits(n) });
  return t(SIZE_KEYS[i - 1], { size: fixedNumber(n / Math.pow(1024, i), 1) });
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

export function formatDate(unixSeconds: number): string {
  return formatDateWith(unixSeconds, DATE_OPTS);
}

/** Date plus wall-clock time, for the viewer's details panel. */
export function formatDateTime(unixSeconds: number): string {
  const date = formatDateWith(unixSeconds, DATE_OPTS);
  const time = formatDateWith(unixSeconds, { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

/**
 * A duration as m:ss, or h:mm:ss once it passes an hour. Used for the audio and
 * video meta lines, where the player's own fmt() is not reachable (it is local
 * to the player screen and formats a live position, not a total).
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "--:--";
  const whole = Math.floor(totalSeconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Extension to the catalog key of its name. Keys, not text, so a language switch is picked up at render. */
const KIND_LABELS: Record<string, MessageKey> = {
  jpg: "common.label.jpegImage", jpeg: "common.label.jpegImage", png: "common.label.pngImage", gif: "common.label.gifImage",
  webp: "common.label.webpImage", heic: "common.label.heicImage", heif: "common.label.heicImage", svg: "common.label.svgImage",
  tiff: "common.label.tiffImage", tif: "common.label.tiffImage", dng: "common.label.dngRawPhoto", avif: "common.label.avifImage", bmp: "common.label.bitmapImage",
  mp4: "common.label.mp4Video", mov: "common.label.quicktimeVideo", webm: "common.label.webmVideo", mkv: "common.label.matroskaVideo",
  mp3: "common.label.mp3Audio", m4a: "common.label.aacAudio", aac: "common.label.aacAudio", wav: "common.label.wavAudio", flac: "common.label.flacAudio",
  ogg: "common.label.oggAudio", oga: "common.label.oggAudio", opus: "common.label.opusAudio", wma: "common.label.windowsMediaAudio", mka: "common.label.matroskaAudio",
  pdf: "common.label.pdf", epub: "common.label.epub", mobi: "common.label.mobi", azw: "common.label.kindleBook", azw3: "common.label.kindleBook",
  cbz: "common.label.comicBook", fb2: "common.label.fictionbook",
  md: "common.label.markdown", markdown: "common.label.markdown", txt: "common.label.plainText", log: "common.label.logFile",
  csv: "common.label.csv", tsv: "common.label.tsv", json: "common.label.json", xml: "common.label.xml", yml: "common.label.yaml", yaml: "common.label.yaml", sql: "common.label.sql",
  srt: "common.label.subtitles", vtt: "common.label.subtitles", ass: "common.label.subtitles", ssa: "common.label.subtitles",
  zip: "common.label.zipArchive", rar: "common.label.rarArchive", "7z": "common.label.7ZipArchive", tar: "common.label.tarArchive", gz: "common.label.gzipArchive",
  doc: "common.label.wordDocument", docx: "common.label.wordDocument", xls: "common.label.spreadsheet", xlsx: "common.label.spreadsheet",
  ppt: "common.label.presentation", pptx: "common.label.presentation", vcf: "common.label.vcard",
  ics: "common.label.calendar", ical: "common.label.calendar", icalendar: "common.label.calendar",
};

/**
 * A short human name for a file's type - "JPEG image", "PDF", "Markdown".
 *
 * The old detail screen printed the raw mime string ("application/vnd.openxml
 * formats-officedocument.spreadsheetml.sheet" and friends), which is both
 * unreadable and, at that length, pushed the rest of the meta line off screen.
 * Falls back to the uppercased extension, then to a generic word, so this
 * NEVER returns an empty string - the meta line's separators depend on it.
 */
export function kindLabel(mime: string, ext: string | null): string {
  const e = normalizeExt(ext);
  const named = Object.prototype.hasOwnProperty.call(KIND_LABELS, e) ? KIND_LABELS[e] : undefined;
  if (named) return t(named);
  if (e) return e.toUpperCase();

  const m = (mime || "").toLowerCase();
  const generic = fileKind(m, ext);
  if (generic === "image") return t("common.label.image");
  if (generic === "video") return t("common.label.videoTitleCase");
  if (generic === "audio") return t("common.label.audio");
  if (generic === "text") return t("common.label.text");
  if (generic === "book") return t("common.label.book");
  return t("common.label.fileTitleCase");
}

/**
 * A text body as its lines, dropping the single trailing newline almost
 * every file ends with so it doesn't read as one extra empty line. Shared
 * with `lineCount` so the two never drift on what counts as a line.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n");
}

/** How many lines a text body has, by the same rule as `splitLines`. */
export function lineCount(text: string): number {
  return splitLines(text).length;
}

/** A filename with its final extension removed - the viewer's book/audio title. */
export function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Extensions that read as text even when the mime is generic. Broad on
 * purpose: the cost of a wrong entry is a mono card full of gibberish and a
 * Save button, while the cost of a missing one is a file the app claims it
 * cannot open at all. Subtitles (srt/vtt/ass/ssa) matter doubly now that the
 * MKVs they ride alongside play in-app.
 */
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "css", "html", "xml", "yml", "yaml", "csv", "tsv", "sql", "sh", "log",
  "py", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "php", "rb", "lua", "dart", "vue", "svelte",
  "toml", "ini", "conf", "env", "gradle", "properties", "ps1", "bat", "cmd", "diff", "patch",
  "srt", "vtt", "ass", "ssa",
  // Calendars: read as text, then shown as a calendar when they hold events.
  "ics", "ical", "icalendar",
]);

/**
 * The extension fallback for image files whose mime never made it - a
 * .tiff uploaded over WebDAV arrives as application/octet-stream and used to
 * fall through to the glyph stage. Whether the OS then decodes it is the
 * ImageStage's problem (and its failure card's job to admit): iOS ImageIO
 * knows TIFF and DNG, Android's decoder does not know TIFF at all.
 */
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "svg", "bmp", "ico", "tiff", "tif", "dng"]);

// zip, plus the two disk-image extensions the API lists the same way (ISO 9660;
// a raw .img is refused with a sentence the screen shows). Not .cbz or .epub:
// those are zips too, but the reader already claims them.
const ARCHIVE_EXTS = new Set(["zip", "iso", "img"]);
export function isArchiveName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && ARCHIVE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

const OFFICE_EXTS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"]);
const OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

// cbz and fb2 ride along because the vendored foliate reader already carries
// their loaders (see scripts/build-reader.mjs) - the classifier was the only
// thing keeping comics and FictionBook out. cbr does NOT: that is a RAR, and
// the reader's unzip (zip.js/fflate) cannot open it.
const BOOK_EXTS = new Set(["epub", "mobi", "azw", "azw3", "cbz", "fb2"]);
const BOOK_MIMES = new Set([
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
  "application/vnd.comicbook+zip",
  "application/x-cbz",
  "application/x-fictionbook+xml",
]);

/**
 * Lowercase an extension and drop the leading dot. The API stores extensions
 * dot-prefixed (".epub"), so every comparison against the bare sets below has
 * to normalize first, or the extension fallback silently never matches.
 *
 * Exported because this trap is not local to this module: the audio metadata
 * extractor matched `ext === "mp3"` against the same dot-prefixed value and
 * silently skipped every parser it had (see metadata/extract.ts). Anything
 * comparing `file.extension` to a bare extension must come through here.
 */
export function normalizeExt(ext: string | null): string {
  const e = (ext || "").toLowerCase();
  return e.startsWith(".") ? e.slice(1) : e;
}

export function fileKind(mime: string, ext: string | null): "image" | "video" | "audio" | "pdf" | "text" | "book" | "office" | "other" {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("text/")) return "text";
  if (BOOK_MIMES.has(m)) return "book";
  // Office documents are viewable, just not directly: the server converts them
  // to PDF and the viewer shows that. Without this branch they fall through to
  // "other" and the viewer offers nothing but a download.
  if (OFFICE_MIMES.has(m)) return "office";
  const e = normalizeExt(ext);
  if (IMAGE_EXTS.has(e)) return "image";
  if (BOOK_EXTS.has(e)) return "book";
  if (TEXT_EXTS.has(e)) return "text";
  if (OFFICE_EXTS.has(e)) return "office";
  return "other";
}

/** Which reader body a file gets on the read route; null = not readable. */
export function readerType(mime: string, ext: string | null): "book" | "pdf" | "txt" | null {
  const kind = fileKind(mime, ext);
  if (kind === "book") return "book";
  if (kind === "pdf") return "pdf";
  if (kind === "text" && normalizeExt(ext) === "txt") return "txt";
  return null;
}
