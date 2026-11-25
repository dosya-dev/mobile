import { fireEvent, render, screen } from "@testing-library/react-native";
import { FileThumb } from "./FileThumb";
import type { FileItem } from "./types";

const base: FileItem = {
  id: "f1", name: "x", size_bytes: 1, mime_type: "", extension: null,
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};

// This used to assert /raw, on the reasoning that /thumb always 302s for
// passthrough formats and native loaders drop the auth header across a
// redirect. True at every width EXCEPT 128, which is the only one a list
// needs: there the server answers from the embedded EXIF preview in one hop
// with a few KB. Fetching /raw meant pulling the multi-megabyte ORIGINAL for
// every row, which is why a hundred photos took minutes on the phone and
// seconds in the browser.
it("asks for the cheap embedded preview first for a JPEG", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="list" />);
  const img = screen.getByTestId("thumb-img-f1");
  expect(img.props.source.uri).toMatch(/\/thumb\?/);
  expect(img.props.source.uri).toContain("w=128");
});

// Screenshots and re-encoded JPEGs often carry no EXIF thumbnail. The server
// falls through to its redirect, the auth header is lost, and the request 401s
// - so the row has to try the original rather than give up and show an icon.
it("falls back to the original when the preview cannot be served", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="list" />);
  fireEvent(screen.getByTestId("thumb-img-f1"), "error", { error: "401" });
  expect(screen.getByTestId("thumb-img-f1").props.source.uri).toMatch(/\/api\/files\/f1\/raw/);
});

it("gives up on the icon only after every candidate has failed", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="list" />);
  fireEvent(screen.getByTestId("thumb-img-f1"), "error", { error: "401" });
  fireEvent(screen.getByTestId("thumb-img-f1"), "error", { error: "500" });
  expect(screen.queryByTestId("thumb-img-f1")).toBeNull();
});

it("asks the server to resize a PNG rather than pulling the original", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/png", extension: "png" }} variant="list" />);
  expect(screen.getByTestId("thumb-img-f1").props.source.uri).toMatch(/\/thumb\?/);
});

it("goes straight to the original for a WebP, which has no derivative path", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/webp", extension: "webp" }} variant="list" />);
  expect(screen.getByTestId("thumb-img-f1").props.source.uri).toMatch(/\/api\/files\/f1\/raw/);
});

it("renders HEIC via /thumb (server decodes it in one hop)", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/heic", extension: "heic" }} variant="grid" />);
  const img = screen.getByTestId("thumb-img-f1");
  expect(img.props.source.uri).toMatch(/\/api\/files\/f1\/thumb/);
});

it("renders an icon (no image) for non-image files", () => {
  render(<FileThumb file={{ ...base, mime_type: "application/pdf", extension: "pdf" }} variant="list" />);
  expect(screen.queryByTestId("thumb-img-f1")).toBeNull();
});

// Videos used to be a bare play glyph everywhere. They now ask /thumb for the
// poster a client stored (see VideoPoster.test.tsx for the rest of the walk),
// and a grid tile keeps a small play mark so the frame still reads as a video.
it("shows a video's poster frame, with a play mark on grid tiles", () => {
  render(<FileThumb file={{ ...base, mime_type: "video/mp4", extension: "mp4" }} variant="grid" />);
  expect(screen.queryByTestId("thumb-img-f1")).toBeNull();
  expect(screen.getByTestId("video-poster-f1").props.source.uri).toMatch(/\/api\/files\/f1\/thumb\?.*w=512/);
  expect(screen.getByTestId("video-glyph")).toBeTruthy();
});

// Scrolling past a row tears its load down mid-flight, and Glide reports that
// the same way it reports a real failure. Counting it burns through the
// fallback list and strands a perfectly good picture on a file icon - which is
// what the device log showed: "stream was reset: CANCEL" on attempt 0.
it("does not spend a fallback when the load was merely cancelled", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="list" />);
  const before = screen.getByTestId("thumb-img-f1").props.source.uri;
  fireEvent(screen.getByTestId("thumb-img-f1"), "error", {
    error: "Failed to load resource\nokhttp3.internal.http2.StreamResetException(stream was reset: CANCEL)",
  });
  expect(screen.getByTestId("thumb-img-f1").props.source.uri).toBe(before);
});

it("shows a pulsing placeholder until the image arrives", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="grid" />);
  expect(screen.getByTestId("thumb-skeleton")).toBeTruthy();
  fireEvent(screen.getByTestId("thumb-img-f1"), "load", { source: { width: 10, height: 10 } });
  expect(screen.queryByTestId("thumb-skeleton")).toBeNull();
});

it("shows the Live Photo glyph when live is set", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="grid" live />);
  expect(screen.getByTestId("live-glyph")).toBeTruthy();
});

it("shows no glyph when live is not set", () => {
  render(<FileThumb file={{ ...base, mime_type: "image/jpeg", extension: "jpg" }} variant="grid" />);
  expect(screen.queryByTestId("live-glyph")).toBeNull();
});
