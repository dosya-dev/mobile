const mockFromLocal = jest.fn(async () => true);
jest.mock("./posterCache", () => ({ posterFromLocalVideo: (...a: unknown[]) => mockFromLocal(...(a as [])) }));

import { useUploadStore } from "@/upload/store";
import type { UploadItem } from "@/upload/types";
import { __resetPosterOnUpload, startPosterOnUpload } from "./posterOnUpload";

const item = (over: Partial<UploadItem>): UploadItem => ({
  id: "u1", name: "IMG_1.MOV", uri: "file:///staged/IMG_1.MOV", size: 10, mime: "video/quicktime",
  folderId: null, workspaceId: "ws", status: "uploading", progress: 0, ...over,
});

beforeEach(() => {
  __resetPosterOnUpload();
  mockFromLocal.mockClear();
  useUploadStore.setState({ items: [] });
});

it("makes a poster from the local file once a video upload is done", () => {
  startPosterOnUpload();
  useUploadStore.getState().enqueue([item({})]);
  expect(mockFromLocal).not.toHaveBeenCalled();
  useUploadStore.getState().patch("u1", { status: "done", progress: 1, fileId: "f_new" });
  expect(mockFromLocal).toHaveBeenCalledWith("f_new", "file:///staged/IMG_1.MOV");
});

it("handles each file once, however often the store changes after", () => {
  startPosterOnUpload();
  startPosterOnUpload();
  useUploadStore.getState().enqueue([item({ status: "done", fileId: "f_new" })]);
  useUploadStore.getState().enqueue([item({ id: "u2", name: "x.jpg", mime: "image/jpeg", status: "done", fileId: "f_img" })]);
  expect(mockFromLocal).toHaveBeenCalledTimes(1);
});

it("ignores photos and unfinished uploads", () => {
  startPosterOnUpload();
  useUploadStore.getState().enqueue([
    item({ id: "a", mime: "image/heic", status: "done", fileId: "f1" }),
    item({ id: "b", status: "error", fileId: undefined }),
  ]);
  expect(mockFromLocal).not.toHaveBeenCalled();
});
