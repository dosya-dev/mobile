import { Share } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GlyphStage } from "./GlyphStage";
import { ContactsStage } from "./ContactsStage";
import { BookStage } from "./BookStage";
import { LockGate } from "./LockGate";
import { TextStage } from "./TextStage";
import { CsvStage } from "./CsvStage";
import { MarkdownStage } from "./MarkdownStage";
import { ImageStage } from "./ImageStage";
import { stagePalette } from "../stageTheme";
import { codeTokenColors } from "../codeHighlight";
import { parseVCardFile } from "@/contacts/vcardFile";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

const palette = stagePalette("light");

describe("GlyphStage", () => {
  it("names the type and offers a way forward when there is no preview", () => {
    render(<GlyphStage variant="none" name="backup.bin" mimeType="application/octet-stream" extension=".bin" palette={palette} />);
    expect(screen.getByText("BIN")).toBeTruthy();
    expect(screen.getByText(/No preview for this type/)).toBeTruthy();
  });

  // A zip has somewhere better to go than Save (the "Browse contents"
  // primary action, wired in file/[id].tsx) - its copy says so instead of
  // repeating the generic "save it to open elsewhere" line, which would
  // contradict a button that opens it right here.
  it("names a zip and points at Browse instead of Save", () => {
    render(<GlyphStage variant="none" name="backup.zip" mimeType="application/zip" extension=".zip" palette={palette} />);
    expect(screen.getByText("ZIP archive")).toBeTruthy();
    expect(screen.getByText("Browse this archive without saving it.")).toBeTruthy();
    expect(screen.queryByText(/No preview for this type/)).toBeNull();
  });

  // The feature is structurally zip-only - archiveTree.ts addresses entries
  // by central-directory index, a concept RAR/7z/tar don't have, and the
  // server's index endpoint refuses anything that isn't a zip. This pins the
  // message to the SAME isArchiveName predicate that gates the "Browse
  // contents" primary action, not to GlyphStage's own broader ARCHIVE_EXTS
  // regex (which is right for the icon - a .rar still gets the archive
  // glyph - but was wrong for this copy, which would have promised a button
  // that isn't there).
  it("does not offer Browse for a non-zip archive - the browser cannot open one", () => {
    render(<GlyphStage variant="none" name="backup.rar" mimeType="application/x-rar-compressed" extension=".rar" palette={palette} />);
    expect(screen.getByText("RAR archive")).toBeTruthy();
    expect(screen.getByText("No preview for this type. Save it to your phone to open it in another app.")).toBeTruthy();
    expect(screen.queryByText("Browse this archive without saving it.")).toBeNull();
  });

  it("puts the real size in the too-large message", () => {
    render(
      <GlyphStage
        variant="too-large"
        name="worker.log"
        mimeType="text/plain"
        extension=".log"
        sizeLabel="412 MB"
        palette={palette}
      />,
    );
    expect(screen.getByText(/412 MB is too large to preview/)).toBeTruthy();
  });

  it("explains a failure instead of showing an empty box", () => {
    render(<GlyphStage variant="error" name="pic.png" mimeType="image/png" extension=".png" palette={palette} />);
    expect(screen.getByText("Could not load")).toBeTruthy();
    expect(screen.getByText(/connection may have dropped/)).toBeTruthy();
  });

  // An Android phone with no TIFF decoder is not a dropped connection, and
  // must not be told to retry - naming the format points at the fix.
  it("blames the decoder, not the connection, when the phone cannot decode it", () => {
    render(<GlyphStage variant="undecodable" name="scan.tiff" mimeType="image/tiff" extension=".tiff" palette={palette} />);
    expect(screen.getByText("TIFF image")).toBeTruthy();
    expect(screen.getByText(/no TIFF image decoder/)).toBeTruthy();
    expect(screen.queryByText(/connection/)).toBeNull();
  });
});

describe("ContactsStage", () => {
  const vcf = parseVCardFile(
    ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Ken Thompson", "Barbara Liskov", "Edsger Dijkstra"]
      .map((n) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${n}\r\nTEL:+1 555 000 111\r\nEND:VCARD\r\n`)
      .join(""),
  );

  // "186 contacts" tells you the size of the file and nothing about which file
  // it is, which matters when an account holds several .vcf backups.
  it("peeks at the first few real names", () => {
    render(<ContactsStage cards={vcf.cards} total={vcf.cards.length} />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Ken Thompson")).toBeTruthy();
    expect(screen.queryByText("Barbara Liskov")).toBeNull();
  });

  it("counts the ones it did not show", () => {
    render(<ContactsStage cards={vcf.cards} total={vcf.cards.length} />);
    expect(screen.getByText("and 2 more")).toBeTruthy();
  });

  it("says nothing extra when the whole book fits", () => {
    render(<ContactsStage cards={vcf.cards.slice(0, 3)} total={3} />);
    expect(screen.queryByTestId("contact-peek-rest")).toBeNull();
  });
});

describe("BookStage", () => {
  it("titles the cover with the filename, extension dropped", () => {
    render(<BookStage fileId="f1" name="left-hand-of-darkness.epub" palette={palette} />);
    expect(screen.getByText("left-hand-of-darkness")).toBeTruthy();
  });

  it("surfaces the reading position the reader already saves", () => {
    render(<BookStage fileId="f1" name="moby.epub" percent={0.34} palette={palette} />);
    expect(screen.getByText("34% read")).toBeTruthy();
    expect(screen.getByTestId("book-progress")).toBeTruthy();
  });

  it("shows no progress bar for a book never opened", () => {
    render(<BookStage fileId="f1" name="moby.epub" percent={0} palette={palette} />);
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.queryByTestId("book-progress")).toBeNull();
  });
});

describe("LockGate", () => {
  it("will not submit an empty password", () => {
    const onSubmit = jest.fn();
    render(<LockGate busy={false} error={null} onSubmit={onSubmit} palette={palette} />);
    fireEvent.press(screen.getByTestId("unlock"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits what was typed", () => {
    const onSubmit = jest.fn();
    render(<LockGate busy={false} error={null} onSubmit={onSubmit} palette={palette} />);
    fireEvent.changeText(screen.getByTestId("unlock-password"), "hunter2");
    fireEvent.press(screen.getByTestId("unlock"));
    expect(onSubmit).toHaveBeenCalledWith("hunter2");
  });

  it("keeps the field on screen and shows why the last try failed", () => {
    render(<LockGate busy={false} error="Wrong password" onSubmit={jest.fn()} palette={palette} />);
    expect(screen.getByTestId("unlock-password")).toBeTruthy();
    expect(screen.getByText("Wrong password")).toBeTruthy();
  });
});

describe("TextStage", () => {
  it("says what the file is and how much of it there is", () => {
    render(<TextStage text={"one\ntwo\nthree"} mimeType="text/markdown" extension=".md" mutedColor="#888" />);
    expect(screen.getByText("Markdown")).toBeTruthy();
    expect(screen.getByText("3 lines")).toBeTruthy();
  });

  it("waits without claiming the file is empty", () => {
    render(<TextStage text={null} mimeType="text/plain" extension=".txt" mutedColor="#888" />);
    expect(screen.queryByTestId("text-stage-body")).toBeNull();
  });

  // The nested ScrollView sits inside the horizontal, paging FlatList that
  // swipes between files - without this prop Android hands the swipe to the
  // pager instead of the text box, and the box reads as frozen.
  it("opts the body into nested scrolling, so the pager doesn't swallow the swipe", () => {
    render(<TextStage text={"one\ntwo\nthree"} mimeType="text/plain" extension=".txt" mutedColor="#888" />);
    expect(screen.getByTestId("text-stage-body").props.nestedScrollEnabled).toBe(true);
  });

  it("numbers every line in the gutter", () => {
    render(<TextStage text={"one\ntwo\nthree"} mimeType="text/plain" extension=".txt" mutedColor="#888" />);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("scrolls long lines sideways by default, and wraps them instead once toggled", () => {
    render(<TextStage text={"a very long line of text"} mimeType="text/plain" extension=".txt" mutedColor="#888" />);
    expect(screen.getByTestId("text-stage-hscroll")).toBeTruthy();

    fireEvent.press(screen.getByTestId("text-stage-wrap"));
    expect(screen.queryByTestId("text-stage-hscroll")).toBeNull();
    expect(screen.getByTestId("text-stage-wrap").props.accessibilityState.selected).toBe(true);
  });

  it("copies the raw text, not a rendering of it, to the clipboard", async () => {
    const Clipboard = require("expo-clipboard") as { setStringAsync: jest.Mock };
    const { toast } = require("@/ui/toast") as { toast: jest.Mock };
    render(<TextStage text={"SELECT * FROM files"} mimeType="text/plain" extension=".sql" mutedColor="#888" />);

    fireEvent.press(screen.getByTestId("text-stage-copy"));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("SELECT * FROM files");
    await waitFor(() => expect(toast).toHaveBeenCalled());
  });

  it("shares the raw text through the system sheet", () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    render(<TextStage text={"one\ntwo"} mimeType="text/plain" extension=".txt" mutedColor="#888" />);

    fireEvent.press(screen.getByTestId("text-stage-share"));
    expect(share).toHaveBeenCalledWith({ message: "one\ntwo" });
    share.mockRestore();
  });

  it("colours a recognized language's keywords as their own span", () => {
    const light = codeTokenColors("light");
    render(<TextStage text={"SELECT * FROM files"} mimeType="text/plain" extension=".sql" mutedColor="#888" />);
    const keyword = screen.getByText("SELECT");
    expect(keyword.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: light.keyword })]),
    );
  });

  it("leaves an unrecognized extension as plain, unsplit text", () => {
    render(<TextStage text={"SELECT * FROM files"} mimeType="text/plain" extension=".log" mutedColor="#888" />);
    // No language mapping for .log, so the line is one run - "SELECT" never
    // appears as its own node the way it does once .sql is tokenized above.
    expect(screen.queryByText("SELECT")).toBeNull();
    expect(screen.getByText("SELECT * FROM files")).toBeTruthy();
  });

  it("hides the toolbar while the file is still loading", () => {
    render(<TextStage text={null} mimeType="text/plain" extension=".sql" mutedColor="#888" />);
    expect(screen.queryByTestId("text-stage-copy")).toBeNull();
  });
});

describe("ImageStage", () => {
  // The API returns no dimensions; the native loader knows them anyway.
  it("reports the natural size upward so the meta line can show it", () => {
    const onDimensions = jest.fn();
    render(<ImageStage uri="https://r2/x" palette={palette} onDimensions={onDimensions} />);
    fireEvent(screen.getByTestId("image-stage"), "load", { source: { width: 4032, height: 3024 } });
    expect(onDimensions).toHaveBeenCalledWith("4032 x 3024");
  });

  it("reports nothing when the loader gives no size", () => {
    const onDimensions = jest.fn();
    render(<ImageStage uri="https://r2/x" palette={palette} onDimensions={onDimensions} />);
    fireEvent(screen.getByTestId("image-stage"), "load", { source: null });
    expect(onDimensions).not.toHaveBeenCalled();
  });

  it("escalates a broken image to the failure stage", () => {
    const onFailed = jest.fn();
    render(<ImageStage uri="https://r2/x" palette={palette} onFailed={onFailed} />);
    fireEvent(screen.getByTestId("image-stage"), "error", {});
    expect(onFailed).toHaveBeenCalled();
  });
});

describe("CsvStage", () => {
  const csv = "name,size,kind\nreport.pdf,12,PDF\nnotes.txt,3,Text\n";

  it("renders a real table: header cells and body cells, not a wall of commas", () => {
    render(<CsvStage text={csv} mimeType="text/csv" extension=".csv" mutedColor="#888" />);
    expect(screen.getByTestId("csv-stage-body")).toBeTruthy();
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText(/2 rows x 3 cols/)).toBeTruthy();
  });

  it("falls back to the plain text card when the body is not usefully a table", () => {
    render(<CsvStage text="just one sentence" mimeType="text/csv" extension=".csv" mutedColor="#888" />);
    expect(screen.queryByTestId("csv-stage-body")).toBeNull();
    expect(screen.getByTestId("text-stage-body")).toBeTruthy();
  });

  it("waits without claiming the file is empty", () => {
    render(<CsvStage text={null} mimeType="text/csv" extension=".csv" mutedColor="#888" />);
    expect(screen.queryByTestId("csv-stage-body")).toBeNull();
    expect(screen.queryByTestId("text-stage-body")).toBeNull();
  });
});

describe("MarkdownStage", () => {
  it("renders the document, not the source", () => {
    render(<MarkdownStage text={"# Title\n\nSome **bold** words"} mutedColor="#888" />);
    expect(screen.getByTestId("markdown-stage-body")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
    // The raw markers must not survive into the render.
    expect(screen.queryByText(/# Title/)).toBeNull();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("numbers ordered lists and bullets the rest", () => {
    render(<MarkdownStage text={"1. first\n2. second\n\n- loose"} mutedColor="#888" />);
    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("2.")).toBeTruthy();
    expect(screen.getByText("•")).toBeTruthy();
  });

  it("waits without claiming the file is empty", () => {
    render(<MarkdownStage text={null} mutedColor="#888" />);
    expect(screen.queryByTestId("markdown-stage-body")).toBeNull();
  });
});
