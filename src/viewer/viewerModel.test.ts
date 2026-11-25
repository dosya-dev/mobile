import {
  actionAvailability,
  detailRows,
  lockBadge,
  metaParts,
  primaryAction,
  stageKind,
  type StageInput,
} from "./viewerModel";
import type { FileDetail } from "@/files/types";
import { formatDateTime } from "@/files/format";

function makeFile(over: Partial<FileDetail> = {}): FileDetail {
  return {
    id: "f1",
    name: "photo.jpg",
    size_bytes: 2_517_193,
    mime_type: "image/jpeg",
    extension: ".jpg",
    created_at: 1_754_200_000,
    updated_at: 1_754_200_000,
    current_version: 1,
    lock_mode: "none",
    share_count: 0,
    comment_count: 0,
    ...over,
  };
}

function stageFor(over: Partial<StageInput> = {}) {
  return stageKind({
    file: makeFile(),
    gated: false,
    failed: false,
    textTooLarge: false,
    isContacts: false,
    ...over,
  });
}

describe("stageKind", () => {
  it("maps each media type to its own stage", () => {
    expect(stageFor({ file: makeFile({ mime_type: "image/png" }) })).toBe("image");
    expect(stageFor({ file: makeFile({ mime_type: "video/mp4" }) })).toBe("video");
    expect(stageFor({ file: makeFile({ mime_type: "audio/mpeg" }) })).toBe("audio");
    expect(stageFor({ file: makeFile({ mime_type: "application/pdf" }) })).toBe("pdf");
    expect(stageFor({ file: makeFile({ mime_type: "text/plain" }) })).toBe("text");
    expect(stageFor({ file: makeFile({ mime_type: "application/epub+zip" }) })).toBe("book");
  });

  it("falls back to the no-preview stage for an unknown type", () => {
    expect(stageFor({ file: makeFile({ mime_type: "application/zip", extension: ".zip" }) })).toBe("none");
  });

  // A .vcf is text/vcard. The screen this replaces ordered the text branch
  // first, so a contact file rendered raw BEGIN:VCARD source.
  it("sends a calendar with events to the calendar stage, and one without to text", () => {
    const ics = makeFile({ mime_type: "text/calendar", extension: ".ics", name: "Personal.ics" });
    expect(stageFor({ file: ics, isCalendar: true })).toBe("calendar");
    expect(stageFor({ file: ics, isCalendar: false })).toBe("text");
    expect(stageFor({ file: makeFile({ mime_type: "application/octet-stream", extension: ".ics" }) })).toBe("text");
    expect(stageFor({ file: ics, isCalendar: false, textTooLarge: true })).toBe("too-large");
    // A Takeout export over the text cap: the route reads it, so it outranks too-large.
    expect(stageFor({ file: ics, isCalendar: true, textTooLarge: true })).toBe("calendar");
    expect(primaryAction({ file: ics, stage: "calendar" })).toEqual({ kind: "calendar", label: "Open", tone: "solid" });
  });

  it("sends a vCard to the contacts stage, not the text stage", () => {
    const vcf = makeFile({ mime_type: "text/vcard", extension: ".vcf", name: "contacts.vcf" });
    expect(stageFor({ file: vcf, isContacts: true })).toBe("contacts");
  });

  it("splits csv and markdown off the text stage by extension", () => {
    expect(stageFor({ file: makeFile({ mime_type: "text/csv", extension: ".csv" }) })).toBe("csv");
    expect(stageFor({ file: makeFile({ mime_type: "application/octet-stream", extension: ".tsv" }) })).toBe("csv");
    expect(stageFor({ file: makeFile({ mime_type: "text/markdown", extension: ".md" }) })).toBe("markdown");
    expect(stageFor({ file: makeFile({ mime_type: "application/octet-stream", extension: ".markdown" }) })).toBe("markdown");
    // Plain text keeps the plain card.
    expect(stageFor({ file: makeFile({ mime_type: "text/plain", extension: ".txt" }) })).toBe("text");
  });

  it("too-large outranks the csv and markdown stages - their parsers never see an unfetched body", () => {
    const csv = makeFile({ mime_type: "text/csv", extension: ".csv" });
    expect(stageFor({ file: csv, textTooLarge: true })).toBe("too-large");
    const md = makeFile({ mime_type: "text/markdown", extension: ".md" });
    expect(stageFor({ file: md, textTooLarge: true })).toBe("too-large");
  });

  it("keeps the plain-text stage for a vCard too big to parse", () => {
    const vcf = makeFile({ mime_type: "text/vcard", extension: ".vcf" });
    expect(stageFor({ file: vcf, isContacts: false })).toBe("text");
  });

  it("marks an oversized text body rather than showing an empty box", () => {
    const log = makeFile({ mime_type: "text/plain", extension: ".log", size_bytes: 412_000_000 });
    expect(stageFor({ file: log, textTooLarge: true })).toBe("too-large");
  });

  it("puts the lock gate ahead of every content stage", () => {
    expect(stageFor({ gated: true })).toBe("locked");
    expect(stageFor({ gated: true, failed: true })).toBe("locked");
  });

  it("puts a failed fetch ahead of the content stage it would have used", () => {
    expect(stageFor({ failed: true })).toBe("error");
  });

  // The oversize cap only exists because the text stage reads the whole body
  // into JS. An image is streamed by the native loader and is never "too large".
  it("never marks a non-text file too large", () => {
    expect(stageFor({ file: makeFile({ size_bytes: 900_000_000 }), textTooLarge: true })).toBe("image");
  });
});

describe("primaryAction", () => {
  it("offers no button for an image - the icon row already covers it", () => {
    expect(primaryAction({ file: makeFile(), stage: "image" })).toBeNull();
  });

  it("opens the reader for a PDF", () => {
    const a = primaryAction({ file: makeFile({ mime_type: "application/pdf" }), stage: "pdf" });
    expect(a).toEqual({ kind: "read", label: "Read", tone: "solid" });
  });

  it("says Continue reading only once a book has been started", () => {
    const book = makeFile({ mime_type: "application/epub+zip", extension: ".epub" });
    expect(primaryAction({ file: book, stage: "book", readPercent: 0 })?.label).toBe("Read");
    expect(primaryAction({ file: book, stage: "book", readPercent: 0.34 })?.label).toBe("Continue reading");
  });

  it("counts the contacts in the button label, and singularises", () => {
    const vcf = makeFile({ mime_type: "text/vcard", extension: ".vcf" });
    expect(primaryAction({ file: vcf, stage: "contacts", contactCount: 186 })?.label).toBe("View 186 contacts");
    expect(primaryAction({ file: vcf, stage: "contacts", contactCount: 1 })?.label).toBe("View 1 contact");
    expect(primaryAction({ file: vcf, stage: "contacts", contactCount: null })?.label).toBe("View contacts");
  });

  it("plays unlocked audio, but not locked audio", () => {
    const audio = makeFile({ mime_type: "audio/mpeg", extension: ".mp3" });
    expect(primaryAction({ file: audio, stage: "audio" })?.kind).toBe("play");
    expect(primaryAction({ file: makeFile({ ...audio, lock_mode: "full_lock" }), stage: "audio" })).toBeNull();
  });

  // An .ogg on iOS: the queue rides AVPlayer, which cannot decode it. A Play
  // button that produces silence is the audio version of the black rectangle.
  it("hides Play when only the on-stage libVLC transport can decode the file", () => {
    const ogg = makeFile({ mime_type: "audio/ogg", extension: ".ogg" });
    expect(primaryAction({ file: ogg, stage: "audio", audioPlayback: "inline" })).toBeNull();
  });

  it("falls back to Save when nothing on the phone decodes the audio", () => {
    const ogg = makeFile({ mime_type: "audio/ogg", extension: ".ogg" });
    expect(primaryAction({ file: ogg, stage: "audio", audioPlayback: "none" })).toEqual({
      kind: "save", label: "Save to phone", tone: "quiet",
    });
  });

  it("csv and markdown stages carry no primary - the content is already on the stage", () => {
    const csv = makeFile({ mime_type: "text/csv", extension: ".csv" });
    expect(primaryAction({ file: csv, stage: "csv" })).toBeNull();
    const md = makeFile({ mime_type: "text/markdown", extension: ".md" });
    expect(primaryAction({ file: md, stage: "markdown" })).toBeNull();
  });

  it("offers a retry when the preview failed", () => {
    expect(primaryAction({ file: makeFile(), stage: "error" })).toEqual({
      kind: "retry", label: "Try again", tone: "quiet",
    });
  });

  it("offers nothing at all behind the lock gate", () => {
    expect(primaryAction({ file: makeFile({ lock_mode: "full_lock" }), stage: "locked" })).toBeNull();
  });

  // Not a zip: a bare unrecognised type is the case this fallback exists for,
  // now that a zip gets its own dedicated Browse action below.
  it("offers Save for a type with no preview", () => {
    const unknown = makeFile({ name: "payload.dat", mime_type: "application/octet-stream", extension: ".dat" });
    expect(primaryAction({ file: unknown, stage: "none" })).toEqual({
      kind: "save", label: "Save to phone", tone: "quiet",
    });
  });

  // The server refuses a view-only download before it presigns, so the button
  // could only ever produce an error the user can do nothing about.
  it("withholds Save from a view-only file with no preview", () => {
    const unknown = makeFile({ name: "payload.dat", mime_type: "application/octet-stream", extension: ".dat", lock_mode: "view_only" });
    expect(primaryAction({ file: unknown, stage: "none" })).toBeNull();
  });

  it("returns the browse kind for a disk image too", () => {
    const iso = makeFile({ name: "disc.iso", mime_type: "application/x-iso9660-image", extension: ".iso" });
    expect(primaryAction({ file: iso, stage: "none" })?.kind).toBe("browse");
    const img = makeFile({ name: "floppy.img", mime_type: "application/octet-stream", extension: ".img" });
    expect(primaryAction({ file: img, stage: "none" })?.kind).toBe("browse");
  });

  it("returns the browse kind for a zip, and never for a pdf or an epub", () => {
    const zip = makeFile({ name: "photos.zip", mime_type: "application/zip", extension: ".zip" });
    expect(primaryAction({ file: zip, stage: "none" })).toEqual({
      kind: "browse", label: "Browse contents", tone: "solid",
    });

    const pdf = makeFile({ name: "scan.pdf", mime_type: "application/pdf", extension: ".pdf" });
    expect(primaryAction({ file: pdf, stage: "pdf" })?.kind).not.toBe("browse");

    const epub = makeFile({ name: "book.epub", mime_type: "application/epub+zip", extension: ".epub" });
    expect(primaryAction({ file: epub, stage: "book" })?.kind).not.toBe("browse");
  });

  // The archive endpoints ignore the file's OWN lock the same way every other
  // preview route does (allowViewOnlyFolders/ignoreOwnFileLock) - unlike Save,
  // which a view-only file withholds entirely, Browse stays offered.
  it("offers Browse even for a view-only zip, unlike Save", () => {
    const zip = makeFile({ name: "photos.zip", mime_type: "application/zip", extension: ".zip", lock_mode: "view_only" });
    expect(primaryAction({ file: zip, stage: "none" })).toEqual({
      kind: "browse", label: "Browse contents", tone: "solid",
    });
  });

  // A gated full_lock zip (no unlock token yet) never reaches the archive
  // branch at all - "locked" is decided before primaryAction is even called
  // for it.
  it("offers nothing for a gated zip - the lock gate wins first", () => {
    const zip = makeFile({ name: "photos.zip", mime_type: "application/zip", extension: ".zip", lock_mode: "full_lock" });
    expect(primaryAction({ file: zip, stage: "locked" })).toBeNull();
  });
});

describe("actionAvailability", () => {
  it("enables everything for an ordinary file", () => {
    expect(actionAvailability(makeFile(), null)).toEqual({
      save: true, link: true, star: true, versions: true, more: true,
    });
  });

  it("disables only Save for a view-only file", () => {
    expect(actionAvailability(makeFile({ lock_mode: "view_only" }), null)).toEqual({
      save: false, link: true, star: true, versions: true, more: true,
    });
  });

  it("withholds the byte-dependent actions until a locked file is unlocked", () => {
    const locked = makeFile({ lock_mode: "full_lock" });
    expect(actionAvailability(locked, null)).toEqual({
      save: false, link: false, star: true, versions: false, more: true,
    });
    expect(actionAvailability(locked, "ut_abc")).toEqual({
      save: true, link: true, star: true, versions: true, more: true,
    });
  });
});

describe("metaParts", () => {
  it("leads with size and a readable type, never the raw mime string", () => {
    const xlsx = makeFile({
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: ".xlsx",
    });
    const parts = metaParts(xlsx);
    expect(parts[1]).toBe("Spreadsheet");
    expect(parts.join(" ")).not.toContain("openxmlformats");
  });

  it("adds only the extras it actually has", () => {
    expect(metaParts(makeFile())).toHaveLength(3);
    expect(metaParts(makeFile(), { dimensions: "4032 x 3024" })).toContain("4032 x 3024");
    expect(metaParts(makeFile(), { durationSec: 102 })).toContain("1:42");
    expect(metaParts(makeFile(), { pageCount: 14 })).toContain("14 pages");
    expect(metaParts(makeFile(), { pageCount: 1 })).toContain("1 page");
    expect(metaParts(makeFile(), { lineCount: 212 })).toContain("212 lines");
    expect(metaParts(makeFile(), { readPercent: 0.34 })).toContain("34% read");
  });

  it("drops extras that are absent or zero rather than printing a placeholder", () => {
    const parts = metaParts(makeFile(), { dimensions: null, durationSec: 0, pageCount: null, lineCount: 0 });
    expect(parts).toHaveLength(3);
  });

  it("never yields an empty part, so a joined line cannot show a stray separator", () => {
    const bare = makeFile({ mime_type: "", extension: null, size_bytes: 0 });
    expect(metaParts(bare).every((p) => p.length > 0)).toBe(true);
  });
});

describe("lockBadge", () => {
  it("names the restriction, or says nothing", () => {
    expect(lockBadge(makeFile(), null)).toBeNull();
    expect(lockBadge(makeFile({ lock_mode: "view_only" }), null)).toBe("View only");
    expect(lockBadge(makeFile({ lock_mode: "full_lock" }), null)).toBe("Locked");
    expect(lockBadge(makeFile({ lock_mode: "full_lock" }), "ut_abc")).toBeNull();
  });
});

describe("detailRows", () => {
  const when = (u: number) => formatDateTime(u);

  it("shows what the endpoint returns, and omits what it does not", () => {
    const rows = detailRows(makeFile({ uploader_name: "Firat Kaya", current_version: 2, share_count: 1 }), {
      regionLabel: "Sydney",
      formatWhen: when,
    });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Added by");
    expect(labels).toContain("Stored in");
    expect(labels).toContain("Version");
    expect(labels).toContain("Links");
  });

  it("omits uploader and region for a row that never carried them", () => {
    const labels = detailRows(makeFile(), { formatWhen: when }).map((r) => r.label);
    expect(labels).not.toContain("Added by");
    expect(labels).not.toContain("Stored in");
    expect(labels).not.toContain("Version");
    expect(labels).not.toContain("Links");
  });

  it("prints Modified only when the file has actually changed since upload", () => {
    const same = detailRows(makeFile(), { formatWhen: when }).map((r) => r.label);
    expect(same).not.toContain("Modified");

    const changed = detailRows(makeFile({ updated_at: 1_754_300_000 }), { formatWhen: when }).map((r) => r.label);
    expect(changed).toContain("Modified");
  });

  it("normalises the API's dot-prefixed extension instead of printing '..jpg'", () => {
    const row = detailRows(makeFile({ extension: ".jpg" }), { formatWhen: when }).find((r) => r.label === "Extension");
    expect(row?.value).toBe(".jpg");
  });
});
