import { render, screen, fireEvent, act, waitFor } from "@testing-library/react-native";
import ArchiveRoute from "./archive";
import type { ArchiveEntry } from "@/archive/archiveTree";

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = { id: "f1", name: "photos.zip" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  router: { back: (...a: unknown[]) => mockBack(...a), push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
}));
import { useArchiveSaveStore } from "@/archive/archiveSaveStore";

const mockApiRequest = jest.fn();
jest.mock("@/api/client", () => ({ apiRequest: (...a: unknown[]) => mockApiRequest(...a) }));

jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "tok123") }));

const mockDownloadToCache = jest.fn(async (..._a: unknown[]) => "file:///cache/report.pdf");
const mockShareFile = jest.fn(async (..._a: unknown[]) => {});
jest.mock("@/files/download", () => ({
  downloadToCache: (...a: unknown[]) => mockDownloadToCache(...a),
  shareFile: (...a: unknown[]) => mockShareFile(...a),
}));

const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

function entry(over: Partial<ArchiveEntry> & { i: number; name: string }): ArchiveEntry {
  return { size: 0, csize: 0, method: 8, dir: false, encrypted: false, mtime: null, ...over };
}

const entries: ArchiveEntry[] = [
  entry({ i: 0, name: "photos/", dir: true }),
  entry({ i: 1, name: "photos/cat.png", size: 2048 }),
  entry({ i: 2, name: "readme.txt", size: 50 }),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: "f1", name: "photos.zip" };
  useArchiveSaveStore.getState().take();
});

it("names disk images in the 422 message when the file is a .img that is not ISO 9660", async () => {
  const { ApiError } = require("@/api/errors");
  mockParams = { id: "f1", name: "floppy.img" };
  mockApiRequest.mockRejectedValueOnce(new ApiError(
    "This file is not an ISO 9660 disk image. Raw disk images (FAT, ext4, NTFS) are not supported yet.", 422,
  ));
  render(<ArchiveRoute />);
  await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
  expect(screen.getByText(/isn't a valid disk image/)).toBeTruthy();
  expect(screen.getByText(/Raw disk images/)).toBeTruthy();
});

describe("saving into dosya", () => {
  beforeEach(() => {
    mockApiRequest.mockResolvedValue({ kind: "zip", archiveSize: 9999, totalEntries: 3, truncated: false, entries });
  });

  it("parks an entry job and opens the destination picker when a file row's Save is pressed", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));

    fireEvent.press(screen.getByTestId("archive-save-readme.txt"));

    expect(mockPush).toHaveBeenCalledWith("/pick-archive-destination");
    expect(useArchiveSaveStore.getState().take()).toEqual({
      fileId: "f1", archiveName: "photos.zip", version: undefined, kind: "entry", index: 2, name: "readme.txt",
    });
  });

  it("parks a folder plan when a folder row's Save is pressed", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("photos"));

    fireEvent.press(screen.getByTestId("archive-save-photos"));

    expect(mockPush).toHaveBeenCalledWith("/pick-archive-destination");
    const job = useArchiveSaveStore.getState().take();
    expect(job?.kind).toBe("folder");
    if (job?.kind === "folder") {
      expect(job.plan.rootName).toBe("photos");
      expect(job.plan.files).toEqual([{ index: 1, relDir: [], name: "cat.png" }]);
    }
  });

  it("offers Save all in the header, naming the archive for the wrapping folder", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("photos"));

    fireEvent.press(screen.getByTestId("archive-save-all"));

    const job = useArchiveSaveStore.getState().take();
    expect(job?.kind).toBe("folder");
    if (job?.kind === "folder") {
      expect(job.plan.rootName).toBe("photos");
      expect(job.plan.files.map((f) => f.index).sort()).toEqual([1, 2]);
    }
    expect(mockPush).toHaveBeenCalledWith("/pick-archive-destination");
  });

  it("refuses a folder over the cap before parking anything", async () => {
    const many = Array.from({ length: 501 }, (_, i) => entry({ i, name: `big/f${i}.txt` }));
    mockApiRequest.mockResolvedValue({ archiveSize: 1, totalEntries: 501, truncated: false, entries: many });
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("big"));

    fireEvent.press(screen.getByTestId("archive-save-big"));

    expect(mockPush).not.toHaveBeenCalled();
    expect(useArchiveSaveStore.getState().take()).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("501 files"), "error");
  });
});

it("shows a spinner, then the root level once the index resolves", async () => {
  let resolveFetch!: (v: unknown) => void;
  mockApiRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
  render(<ArchiveRoute />);
  expect(screen.getByTestId("archive-loading")).toBeTruthy();

  await act(async () => resolveFetch({ archiveSize: 9999, totalEntries: 3, truncated: false, entries }));
  await waitFor(() => expect(screen.getByText("photos")).toBeTruthy());
  expect(screen.getByText("readme.txt")).toBeTruthy();
  expect(screen.queryByTestId("archive-loading")).toBeNull();
});

it("shows a 'not a valid zip' message for a 422", async () => {
  const { ApiError } = require("@/api/errors");
  mockApiRequest.mockRejectedValueOnce(new ApiError("nope", 422));
  render(<ArchiveRoute />);
  await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
  expect(screen.getByText("This file isn't a valid zip.")).toBeTruthy();
});

it("shows a generic message for a non-422 failure", async () => {
  const { ApiError } = require("@/api/errors");
  mockApiRequest.mockRejectedValueOnce(new ApiError("boom", 500));
  render(<ArchiveRoute />);
  await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
  expect(screen.getByText("This archive could not be opened.")).toBeTruthy();
});

it("says an archive is too large to list, rather than blaming the file", async () => {
  // 413 is a valid archive the server declined to index. The generic message is
  // honest but withholds the one fact the user can act on.
  const { ApiError } = require("@/api/errors");
  mockApiRequest.mockRejectedValueOnce(new ApiError("too large", 413));
  render(<ArchiveRoute />);
  await waitFor(() => expect(screen.getByTestId("archive-error")).toBeTruthy());
  expect(screen.getByText("This archive is too large to list. Download it to open its contents.")).toBeTruthy();
});

it("says there is nothing inside an empty archive", async () => {
  mockApiRequest.mockResolvedValueOnce({ archiveSize: 0, totalEntries: 0, truncated: false, entries: [] });
  render(<ArchiveRoute />);
  await waitFor(() => expect(screen.getByText("There is nothing inside this archive.")).toBeTruthy());
});

it("says a folder is empty rather than drawing a blank level", async () => {
  // A directory entry with nothing under it. The empty state used to key on
  // the archive's total entry count, which is non-zero here, so this level
  // rendered as an empty list with no explanation.
  mockApiRequest.mockResolvedValueOnce({
    archiveSize: 100,
    totalEntries: 1,
    truncated: false,
    entries: [entry({ i: 0, name: "empty/", dir: true })],
  });
  render(<ArchiveRoute />);
  await waitFor(() => screen.getByTestId("archive-dir-empty"));

  fireEvent.press(screen.getByTestId("archive-dir-empty"));

  await waitFor(() => expect(screen.getByText("There is nothing in this folder.")).toBeTruthy());
});

it("still says an archive whose names all neutralise away is empty", async () => {
  // Non-zero count, empty tree: names made only of control or bidi characters
  // are dropped by archiveTree.ts.
  mockApiRequest.mockResolvedValueOnce({
    archiveSize: 40,
    totalEntries: 2,
    truncated: false,
    entries: [entry({ i: 0, name: "\u0001\u0002" }), entry({ i: 1, name: "\u202E\u200F" })],
  });
  render(<ArchiveRoute />);
  await waitFor(() => expect(screen.getByText("There is nothing inside this archive.")).toBeTruthy());
});

it("asks for the version it was given, in the index and in the entry it opens", async () => {
  // Both archive routes accept ?version=N and answer with an hour of private
  // caching and no cache-buster, so an unversioned URL both ignores the
  // version asked for and keeps serving a re-uploaded zip's old contents.
  mockParams = { id: "f1", name: "photos.zip", version: "2" };
  mockApiRequest.mockResolvedValue({ archiveSize: 9999, totalEntries: 3, truncated: false, entries });
  render(<ArchiveRoute />);
  await waitFor(() => screen.getByText("readme.txt"));
  expect(mockApiRequest).toHaveBeenCalledWith("/api/files/f1/archive?version=2");

  fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));
  await waitFor(() => expect(mockDownloadToCache).toHaveBeenCalled());
  expect((mockDownloadToCache.mock.calls[0] as [string])[0]).toContain("version=2");
});

it("omits the version entirely when none was given", async () => {
  mockApiRequest.mockResolvedValue({ archiveSize: 9999, totalEntries: 3, truncated: false, entries });
  render(<ArchiveRoute />);
  await waitFor(() => screen.getByText("readme.txt"));
  expect(mockApiRequest).toHaveBeenCalledWith("/api/files/f1/archive");
});

describe("drilling into a directory", () => {
  beforeEach(() => {
    mockApiRequest.mockResolvedValue({ archiveSize: 9999, totalEntries: 3, truncated: false, entries });
  });

  it("shows the child level and the chip trail after tapping a folder", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("photos"));

    fireEvent.press(screen.getByTestId("archive-dir-photos"));

    // Now inside photos/: its one child is visible and the parent's other
    // sibling (readme.txt) is not part of this level any more.
    await waitFor(() => expect(screen.getByText("cat.png")).toBeTruthy());
    expect(screen.queryByText("readme.txt")).toBeNull();
    expect(screen.getByTestId("archive-chip-1")).toBeTruthy();
  });

  it("jumps back to the root when the root chip is pressed", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("photos"));
    fireEvent.press(screen.getByTestId("archive-dir-photos"));
    await waitFor(() => screen.getByText("cat.png"));

    fireEvent.press(screen.getByTestId("archive-chip-0"));

    await waitFor(() => expect(screen.getByText("readme.txt")).toBeTruthy());
    expect(screen.queryByText("cat.png")).toBeNull();
  });
});

describe("opening a file", () => {
  beforeEach(() => {
    mockApiRequest.mockResolvedValue({ archiveSize: 9999, totalEntries: 3, truncated: false, entries });
  });

  it("previews an image entry with the bearer token as a request header, never in the URL", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByTestId("archive-dir-photos"));
    fireEvent.press(screen.getByTestId("archive-dir-photos"));
    await waitFor(() => screen.getByText("cat.png"));

    fireEvent.press(screen.getByTestId("archive-entry-cat.png"));

    const image = await waitFor(() => screen.getByTestId("archive-preview-image"));
    const source = image.props.source as { uri: string; headers?: Record<string, string> };
    expect(source.uri).toContain("/api/files/f1/archive/entry?i=1");
    expect(source.uri).not.toContain("tok123");
    expect(source.headers).toEqual({ Authorization: "Bearer tok123" });
    // No dl=1 here on purpose: this is a preview, and previewing is exactly
    // what a view-only file permits. Asking for the download rules would
    // refuse a preview the other clients happily show.
    expect(source.uri).not.toContain("dl=1");
  });

  it("downloads and hands a non-image entry to the share sheet, with the token as a header", async () => {
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));

    fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));

    await waitFor(() => expect(mockShareFile).toHaveBeenCalledWith("file:///cache/report.pdf"));
    const [url, filename, opts] = mockDownloadToCache.mock.calls[0] as [string, string, { headers?: Record<string, string> }];
    expect(url).toContain("/api/files/f1/archive/entry?i=2");
    expect(filename).toBe("readme.txt");
    expect(opts.headers).toEqual({ Authorization: "Bearer tok123" });
  });

  it("asks with dl=1 before putting an entry on the device, so a view-only zip is refused", async () => {
    // The share sheet this ends at offers Save to Files and AirDrop. Without
    // dl=1 the server answers off its PREVIEW chain, which allows a view-only
    // file and a view-only ancestor folder on purpose - so a view-only archive
    // could be emptied out entry by entry. dl=1 is what makes the server apply
    // the download rules instead.
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));

    fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));

    await waitFor(() => expect(mockDownloadToCache).toHaveBeenCalled());
    const [url] = mockDownloadToCache.mock.calls[0] as [string];
    expect(url).toContain("dl=1");
  });

  it("says a refusal is a refusal rather than blaming the transfer", async () => {
    const { ApiError } = require("@/api/errors");
    mockDownloadToCache.mockRejectedValueOnce(new ApiError("Download failed (403)", 403));
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));

    fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith("You don't have permission to save or share this entry.", "error"),
    );
  });

  it("toasts an error rather than hanging when the transfer fails", async () => {
    mockDownloadToCache.mockRejectedValueOnce(new Error("network"));
    render(<ArchiveRoute />);
    await waitFor(() => screen.getByText("readme.txt"));

    fireEvent.press(screen.getByTestId("archive-entry-readme.txt"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("This entry could not be transferred.", "error"));
  });
});
