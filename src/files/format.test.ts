import { baseName, formatBytes, fileKind, formatDuration, isArchiveName, kindLabel, lineCount, readerType } from "./format";

describe("formatBytes", () => {
  it("formats zero", () => { expect(formatBytes(0)).toBe("0 B"); });
  it("formats KB/MB/GB with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("fileKind", () => {
  it("classifies by mime first", () => {
    expect(fileKind("image/png", "png")).toBe("image");
    expect(fileKind("video/mp4", "mp4")).toBe("video");
    expect(fileKind("audio/mpeg", "mp3")).toBe("audio");
    expect(fileKind("application/pdf", "pdf")).toBe("pdf");
    expect(fileKind("text/plain", "txt")).toBe("text");
  });
  it("falls back to extension for text-like code files", () => {
    expect(fileKind("application/octet-stream", "md")).toBe("text");
    expect(fileKind("application/octet-stream", "json")).toBe("text");
  });
  it("returns other for unknowns", () => {
    expect(fileKind("application/zip", "zip")).toBe("other");
  });
});

describe("fileKind book detection", () => {
  it("detects epub by mime", () => {
    expect(fileKind("application/epub+zip", null)).toBe("book");
  });
  it("detects mobi/azw/azw3 by extension when mime is generic", () => {
    expect(fileKind("application/octet-stream", "epub")).toBe("book");
    expect(fileKind("application/octet-stream", "mobi")).toBe("book");
    expect(fileKind("", "azw")).toBe("book");
    expect(fileKind("", "AZW3")).toBe("book");
  });
  it("detects amazon/mobipocket mimes", () => {
    expect(fileKind("application/x-mobipocket-ebook", null)).toBe("book");
    expect(fileKind("application/vnd.amazon.ebook", null)).toBe("book");
  });
  it("does not reclassify existing kinds", () => {
    expect(fileKind("application/pdf", null)).toBe("pdf");
    expect(fileKind("text/plain", "txt")).toBe("text");
  });
});

// The API stores extensions dot-prefixed (upload/[sessionId].ts derives
// "." + name.split(".").pop()) and has no ebook entries in its MIME map, so a
// real uploaded book arrives as ("application/octet-stream", ".epub"). These
// cases use that exact shape - bare-extension fixtures let a broken detection
// path pass for months.
describe("real API payload shapes (dot-prefixed extensions)", () => {
  it("detects books uploaded with a generic mime type", () => {
    expect(fileKind("application/octet-stream", ".epub")).toBe("book");
    expect(fileKind("application/octet-stream", ".mobi")).toBe("book");
    expect(fileKind("application/octet-stream", ".AZW3")).toBe("book");
    expect(readerType("application/octet-stream", ".epub")).toBe("book");
  });
  it("detects text files by dot-prefixed extension", () => {
    expect(fileKind("application/octet-stream", ".txt")).toBe("text");
    expect(readerType("text/plain", ".txt")).toBe("txt");
  });
  it("still rejects unknown extensions in the same shape", () => {
    expect(fileKind("application/octet-stream", ".zip")).toBe("other");
    expect(readerType("text/plain", ".ts")).toBeNull();
  });
  it("detects images uploaded with a generic mime type", () => {
    // A .tiff over WebDAV arrives as octet-stream; before the IMAGE_EXTS
    // fallback it fell to the glyph stage with no preview at all.
    expect(fileKind("application/octet-stream", ".png")).toBe("image");
    expect(fileKind("application/octet-stream", ".tiff")).toBe("image");
    expect(fileKind("application/octet-stream", ".TIF")).toBe("image");
    expect(fileKind("", ".dng")).toBe("image");
    expect(fileKind("application/octet-stream", ".heic")).toBe("image");
  });
});

describe("fileKind expansion (2026-08)", () => {
  it("classifies code and config files as text", () => {
    for (const e of ["py", "go", "rs", "java", "kt", "swift", "c", "cpp", "cs", "php", "rb", "lua", "dart", "vue", "svelte", "toml", "ini", "env", "gradle", "ps1", "diff", "patch"]) {
      expect(fileKind("application/octet-stream", `.${e}`)).toBe("text");
    }
  });
  it("classifies subtitles as text, so they open beside the videos they belong to", () => {
    expect(fileKind("application/x-subrip", ".srt")).toBe("text");
    expect(fileKind("text/vtt", ".vtt")).toBe("text");
    expect(fileKind("application/octet-stream", ".ass")).toBe("text");
    expect(kindLabel("application/octet-stream", ".srt")).toBe("Subtitles");
  });
  it("classifies comics and FictionBook as books - the reader's loaders were already vendored", () => {
    expect(fileKind("application/vnd.comicbook+zip", null)).toBe("book");
    expect(fileKind("application/octet-stream", ".cbz")).toBe("book");
    expect(fileKind("application/octet-stream", ".fb2")).toBe("book");
    expect(readerType("application/octet-stream", ".cbz")).toBe("book");
  });
  it("does NOT classify cbr - the reader cannot unrar", () => {
    expect(fileKind("application/octet-stream", ".cbr")).toBe("other");
  });
  it("labels the new image formats honestly", () => {
    expect(kindLabel("application/octet-stream", ".tiff")).toBe("TIFF image");
    expect(kindLabel("application/octet-stream", ".dng")).toBe("DNG raw photo");
  });
});

describe("readerType", () => {
  it("maps book formats", () => {
    expect(readerType("application/epub+zip", null)).toBe("book");
    expect(readerType("application/octet-stream", "mobi")).toBe("book");
  });
  it("maps pdf", () => {
    expect(readerType("application/pdf", "pdf")).toBe("pdf");
  });
  it("maps only .txt text files, not code", () => {
    expect(readerType("text/plain", "txt")).toBe("txt");
    expect(readerType("text/plain", "ts")).toBeNull();
    expect(readerType("text/markdown", "md")).toBeNull();
  });
  it("returns null for everything else", () => {
    expect(readerType("image/png", "png")).toBeNull();
    expect(readerType("video/mp4", "mp4")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats under an hour as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(102)).toBe("1:42");
    expect(formatDuration(2294)).toBe("38:14");
  });
  it("grows to h:mm:ss past an hour", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
  // expo-video reports NaN for a source it has not loaded yet, and the meta
  // line renders whatever it is handed.
  it("does not print NaN for an unmeasured source", () => {
    expect(formatDuration(NaN)).toBe("--:--");
    expect(formatDuration(-1)).toBe("--:--");
  });
});

describe("kindLabel", () => {
  it("names common types the way a person would", () => {
    expect(kindLabel("image/jpeg", ".jpg")).toBe("JPEG image");
    expect(kindLabel("application/pdf", ".pdf")).toBe("PDF");
    expect(kindLabel("text/markdown", ".md")).toBe("Markdown");
    expect(kindLabel("application/zip", ".zip")).toBe("ZIP archive");
  });
  // The API stores extensions dot-prefixed. A bare-set lookup that skips
  // normalizeExt silently matches nothing - the same trap that made the audio
  // metadata extractor a no-op for a whole release.
  it("matches despite the API's leading dot", () => {
    expect(kindLabel("", ".epub")).toBe("EPUB");
    expect(kindLabel("", "epub")).toBe("EPUB");
  });
  it("collapses an unreadable mime string to something short", () => {
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(kindLabel(mime, ".xlsx")).toBe("Spreadsheet");
  });
  it("falls back to the uppercased extension, then to a generic word", () => {
    expect(kindLabel("application/octet-stream", ".sketch")).toBe("SKETCH");
    expect(kindLabel("image/avif", null)).toBe("Image");
    expect(kindLabel("", null)).toBe("File");
  });
});

describe("lineCount", () => {
  it("counts line starts, not newlines", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("one")).toBe(1);
    expect(lineCount("one\ntwo")).toBe(2);
    expect(lineCount("one\ntwo\n")).toBe(2);
    expect(lineCount("\n")).toBe(1);
  });
});

describe("isArchiveName", () => {
  it("matches .zip regardless of case", () => {
    expect(isArchiveName("photos.zip")).toBe(true);
    expect(isArchiveName("PHOTOS.ZIP")).toBe(true);
  });
  it("does not match .cbz or .epub - the reader already claims those zips", () => {
    expect(isArchiveName("comic.cbz")).toBe(false);
    expect(isArchiveName("book.epub")).toBe(false);
  });
  it("does not match other archive formats or an extensionless name", () => {
    expect(isArchiveName("backup.rar")).toBe(false);
    expect(isArchiveName("backup.tar.gz")).toBe(false);
    expect(isArchiveName("README")).toBe(false);
  });
});

describe("baseName", () => {
  it("drops the final extension only", () => {
    expect(baseName("holiday.tar.gz")).toBe("holiday.tar");
    expect(baseName("notes.md")).toBe("notes");
  });
  it("leaves a dotfile and an extensionless name alone", () => {
    expect(baseName(".gitignore")).toBe(".gitignore");
    expect(baseName("README")).toBe("README");
  });
});
