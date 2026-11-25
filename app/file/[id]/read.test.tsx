import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import ReadRoute from "./read";

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { id: "f1" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  router: { replace: (...a: unknown[]) => mockReplace(...a), back: () => mockBack() },
  Stack: { Screen: () => null },
}));

let mockFile: Record<string, unknown>;
jest.mock("@/files/hooks", () => ({ useFile: () => ({ data: mockFile, isLoading: false, isError: false }) }));

const mockGetDownloadUrl = jest.fn(async (..._a: unknown[]) => "https://r2/presigned");
jest.mock("@/files/api", () => ({ getDownloadUrl: (...a: unknown[]) => mockGetDownloadUrl(...a) }));

const mockEnsure = jest.fn();
const mockRelease = jest.fn(async () => {});
jest.mock("@/reader/bookCache", () => ({
  ensureBookCached: (...a: unknown[]) => mockEnsure(...a),
  releaseOpenBooks: () => mockRelease(),
}));
jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "tok") }));

// Captures the exact props read.tsx hands each reader, so tests can assert
// wiring (e.g. onOpenDetails) without rendering the real reader components.
let mockBookReaderProps: Record<string, unknown> = {};
let mockPdfReaderProps: Record<string, unknown> = {};
jest.mock("@/reader/BookReader", () => ({ BookReader: (p: Record<string, unknown>) => {
  mockBookReaderProps = p;
  const { Text } = require("react-native");
  return <Text>BookReader:{p.format as string}</Text>;
}}));
jest.mock("@/reader/PdfReader", () => ({ PdfReader: (p: Record<string, unknown>) => {
  mockPdfReaderProps = p;
  const { Text } = require("react-native");
  return <Text>PdfReader</Text>;
}}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: "f1" };
  mockFile = { id: "f1", name: "moby.epub", extension: "epub", mime_type: "application/epub+zip",
    size_bytes: 1000, current_version: 1, lock_mode: "none" };
  mockEnsure.mockResolvedValue("file:///cache/books/f1-v1.epub");
});

it("renders BookReader for an unlocked epub", async () => {
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:book"));
});

it("renders PdfReader for a pdf", async () => {
  mockFile = { ...mockFile, name: "scan.pdf", extension: "pdf", mime_type: "application/pdf" };
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("PdfReader"));
});

it("redirects locked files without a token to the detail screen", async () => {
  mockFile = { ...mockFile, lock_mode: "full_lock" };
  render(<ReadRoute />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/file/f1"));
  expect(mockEnsure).not.toHaveBeenCalled();
});

it("proceeds for a full_lock file when a token param is present", async () => {
  mockFile = { ...mockFile, lock_mode: "full_lock" };
  mockParams = { id: "f1", token: "tok123" };
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:book"));
  const getUrl = mockEnsure.mock.calls[0][1] as () => Promise<string>;
  await getUrl();
  expect(mockGetDownloadUrl).toHaveBeenCalledWith("f1", "tok123");
});

it("opens a view-only book instead of bouncing it back to the detail screen", async () => {
  // view_only means "readable, not downloadable". The route used to redirect
  // any lock_mode !== "none" without a token, so a view-only book could never
  // be opened at all.
  mockFile = { ...mockFile, lock_mode: "view_only" };
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:book"));
  expect(mockReplace).not.toHaveBeenCalled();
});

it("lets go of the book it was holding open when the reader closes", async () => {
  // A book cannot be streamed - the reader needs a path - so a view-only book
  // is written to disk to be opened at all. Closing the reader is the point at
  // which that copy stops being justified, and this is what removes it.
  mockFile = { ...mockFile, lock_mode: "view_only" };
  const { getByText, unmount } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:book"));
  expect(mockRelease).not.toHaveBeenCalled();
  unmount();
  expect(mockRelease).toHaveBeenCalled();
});

it("reads a view-only book from /raw with a bearer header, never presigning it", async () => {
  mockFile = { ...mockFile, lock_mode: "view_only" };
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:book"));
  const [, getUrl, , headers] = mockEnsure.mock.calls[0] as [unknown, () => Promise<string>, unknown, unknown];
  await expect(getUrl()).resolves.toContain("/api/files/f1/raw");
  expect(headers).toEqual({ Authorization: "Bearer tok" });
  // download-url refuses view_only before presigning, so asking it at all
  // would just be a guaranteed 403.
  expect(mockGetDownloadUrl).not.toHaveBeenCalled();
});

it("redirects non-readable kinds", async () => {
  mockFile = { ...mockFile, name: "pic.png", extension: "png", mime_type: "image/png" };
  render(<ReadRoute />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/file/f1"));
});

it("shows a retry button on download failure and retries", async () => {
  mockEnsure.mockRejectedValueOnce(new Error("Download failed (403)"));
  const { getByTestId, getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("Download failed (403)"));
  mockEnsure.mockResolvedValueOnce("file:///cache/books/f1-v1.epub");
  fireEvent.press(getByTestId("retry-download"));
  await waitFor(() => getByText("BookReader:book"));
});

it("renders BookReader with format txt for a .txt file", async () => {
  mockFile = { ...mockFile, name: "notes.txt", extension: "txt", mime_type: "text/plain" };
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:txt"));
});

it("shows the downloading UI and updates the progress bar as onProgress fires", async () => {
  let onProgress: ((written: number, total: number) => void) | undefined;
  let resolveEnsure!: (uri: string) => void;
  mockEnsure.mockImplementationOnce(
    (_file: unknown, _getUrl: () => Promise<string>, cb?: (written: number, total: number) => void) => {
      onProgress = cb;
      return new Promise<string>((resolve) => { resolveEnsure = resolve; });
    },
  );

  const { getByTestId, getByText, toJSON } = render(<ReadRoute />);

  await waitFor(() => getByTestId("download-progress"));
  expect(getByText("moby.epub")).toBeTruthy();
  expect(getByText("1000 B")).toBeTruthy();

  act(() => { onProgress?.(50, 100); });
  expect(JSON.stringify(toJSON())).toContain("50%");

  resolveEnsure("file:///cache/books/f1-v1.epub");
  await waitFor(() => getByText("BookReader:book"));
});

it("does not stack a second download when retry is pressed", async () => {
  mockEnsure.mockRejectedValueOnce(new Error("Download failed (403)"));
  const { getByTestId, queryByTestId, getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("Download failed (403)"));

  let resolveRetry!: (uri: string) => void;
  mockEnsure.mockImplementationOnce(
    () => new Promise<string>((resolve) => { resolveRetry = resolve; }),
  );
  fireEvent.press(getByTestId("retry-download"));

  // The retry affordance disappears as soon as the retried download starts
  // (phase leaves "error"), so there is no UI path left to press it again -
  // exactly two calls total (initial + the one retry) proves a stray second
  // press can't stack a third in-flight download.
  await waitFor(() => expect(queryByTestId("retry-download")).toBeNull());
  expect(mockEnsure).toHaveBeenCalledTimes(2);

  resolveRetry("file:///cache/books/f1-v1.epub");
  await waitFor(() => getByText("BookReader:book"));
});

it("wires onOpenDetails into BookReader so its error screen can reach the file detail page", async () => {
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("BookReader:book"));
  expect(mockBookReaderProps.onOpenDetails).toEqual(expect.any(Function));
  (mockBookReaderProps.onOpenDetails as () => void)();
  expect(mockReplace).toHaveBeenCalledWith("/file/f1");
});

it("wires onOpenDetails into PdfReader so its error screen can reach the file detail page", async () => {
  mockFile = { ...mockFile, name: "scan.pdf", extension: "pdf", mime_type: "application/pdf" };
  const { getByText } = render(<ReadRoute />);
  await waitFor(() => getByText("PdfReader"));
  expect(mockPdfReaderProps.onOpenDetails).toEqual(expect.any(Function));
  (mockPdfReaderProps.onOpenDetails as () => void)();
  expect(mockReplace).toHaveBeenCalledWith("/file/f1");
});
