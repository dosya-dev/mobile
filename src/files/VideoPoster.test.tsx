const mockEnsurePoster = jest.fn();
const mockCached = { value: null as string | null };
const mockDrop = jest.fn();
jest.mock("./posterCache", () => ({
  cachedPoster: () => mockCached.value,
  ensurePoster: (...a: unknown[]) => mockEnsurePoster(...a),
  dropCachedPoster: (...a: unknown[]) => mockDrop(...a),
}));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

import { Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { VideoPoster } from "./VideoPoster";
import type { FileItem } from "./types";

const file: FileItem = {
  id: "v1", name: "clip.mp4", size_bytes: 1, mime_type: "video/mp4", extension: "mp4",
  created_at: 1, updated_at: 1, current_version: 3, lock_mode: "none", share_count: 0, comment_count: 0,
};
const glyph = <Text testID="glyph">play</Text>;

beforeEach(() => {
  mockCached.value = null;
  mockEnsurePoster.mockReset();
  mockDrop.mockReset();
});

it("asks the server for the stored poster first, with the bearer token", () => {
  render(<VideoPoster file={file} fallback={glyph} />);
  const img = screen.getByTestId("video-poster-v1");
  expect(img.props.source.uri).toMatch(/\/api\/files\/v1\/thumb\?version=3&w=512$/);
  expect(img.props.source.headers).toEqual({ Authorization: "Bearer tok" });
  expect(screen.getByTestId("glyph")).toBeTruthy();
});

it("draws this device's copy straight away when it has one", () => {
  mockCached.value = "file:///cache/video-posters/v1-v3.jpg";
  render(<VideoPoster file={file} />);
  expect(screen.getByTestId("video-poster-v1").props.source.uri).toBe(mockCached.value);
});

it("grabs a frame here when the server has no poster yet", async () => {
  let resolve!: (u: string) => void;
  mockEnsurePoster.mockReturnValue(new Promise((r) => { resolve = r; }));
  render(<VideoPoster file={file} fallback={glyph} />);
  fireEvent(screen.getByTestId("video-poster-v1"), "error", { error: "404" });
  expect(screen.queryByTestId("video-poster-v1")).toBeNull();
  expect(screen.getByTestId("glyph")).toBeTruthy();
  await act(async () => { resolve("file:///cache/video-posters/v1-v3.jpg"); });
  expect(screen.getByTestId("video-poster-v1").props.source.uri).toBe("file:///cache/video-posters/v1-v3.jpg");
});

it("stays on the glyph when no frame can be made", async () => {
  mockEnsurePoster.mockResolvedValue(null);
  render(<VideoPoster file={file} fallback={glyph} />);
  await act(async () => { fireEvent(screen.getByTestId("video-poster-v1"), "error", { error: "404" }); });
  expect(screen.queryByTestId("video-poster-v1")).toBeNull();
  expect(screen.getByTestId("glyph")).toBeTruthy();
});

it("does not treat a cancelled load as a missing poster", () => {
  render(<VideoPoster file={file} />);
  fireEvent(screen.getByTestId("video-poster-v1"), "error", { error: "stream was reset: CANCEL" });
  expect(mockEnsurePoster).not.toHaveBeenCalled();
  expect(screen.getByTestId("video-poster-v1")).toBeTruthy();
});

it("drops a local copy that will not render and makes one fresh frame, then gives up", async () => {
  mockCached.value = "file:///cache/video-posters/v1-v3.jpg";
  mockEnsurePoster.mockResolvedValue("file:///cache/video-posters/v1-v3.jpg");
  render(<VideoPoster file={file} fallback={glyph} />);
  await act(async () => { fireEvent(screen.getByTestId("video-poster-v1"), "error", { error: "decode" }); });
  expect(mockDrop).toHaveBeenCalledTimes(1);
  expect(mockEnsurePoster).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent(screen.getByTestId("video-poster-v1"), "error", { error: "decode" }); });
  expect(mockEnsurePoster).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("video-poster-v1")).toBeNull();
});

it("never shows a picture of a fully locked video", () => {
  render(<VideoPoster file={{ ...file, lock_mode: "full_lock" }} fallback={glyph} />);
  expect(screen.queryByTestId("video-poster-v1")).toBeNull();
  expect(mockEnsurePoster).not.toHaveBeenCalled();
});
