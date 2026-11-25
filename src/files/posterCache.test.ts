const mockExisting = new Set<string>();
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockExisting.has(this.uri); }
    delete() { mockExisting.delete(this.uri); }
  },
}));
const mockUploadAsync = jest.fn(async () => ({ status: 200 }));
jest.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async ({ to }: { to: string }) => { mockExisting.add(to); }),
  uploadAsync: (...a: unknown[]) => (mockUploadAsync as jest.Mock)(...a),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));

import * as VideoThumbnails from "expo-video-thumbnails";
import { ImageManipulator } from "expo-image-manipulator";
import {
  __resetPosterState, cachedPoster, ensurePoster, grabPosterFrame, localPosterPath, posterFromLocalVideo,
} from "./posterCache";

const grab = VideoThumbnails.getThumbnailAsync as jest.Mock;
const manipulate = ImageManipulator.manipulate as jest.Mock;
const resize = jest.fn();

beforeEach(() => {
  mockExisting.clear();
  __resetPosterState();
  grab.mockReset();
  mockUploadAsync.mockClear();
  resize.mockReset();
  manipulate.mockReset();
  const ctx = {
    resize: (...a: unknown[]) => { resize(...a); return ctx; },
    renderAsync: async () => ({ saveAsync: async () => ({ uri: "file:///tmp/small.jpg" }) }),
  };
  manipulate.mockReturnValue(ctx);
});

const video = { id: "f_vid", current_version: 2 };

it("grabs a frame from /raw with the bearer token, shrinks it, keeps it and offers it to the server", async () => {
  grab.mockResolvedValue({ uri: "file:///tmp/frame.jpg", width: 3840, height: 2160 });

  const uri = await ensurePoster(video);

  expect(uri).toBe(localPosterPath(video));
  const [source, opts] = grab.mock.calls[0];
  expect(source).toMatch(/\/api\/files\/f_vid\/raw\?version=2$/);
  expect(opts.headers).toEqual({ Authorization: "Bearer tok" });
  expect(resize).toHaveBeenCalledWith({ width: 640 });
  expect(cachedPoster(video)).toBe(localPosterPath(video));
  await Promise.resolve();
  const [url, file, up] = mockUploadAsync.mock.calls[0] as unknown as [string, string, { httpMethod: string; headers: Record<string, string> }];
  expect(url).toMatch(/\/api\/files\/f_vid\/poster\?version=2$/);
  expect(file).toBe(localPosterPath(video));
  expect(up.httpMethod).toBe("PUT");
  expect(up.headers["Content-Type"]).toBe("image/jpeg");
});

it("shrinks a portrait frame by its height", async () => {
  grab.mockResolvedValue({ uri: "file:///tmp/frame.jpg", width: 1080, height: 1920 });
  await grabPosterFrame("file:///v.mov");
  expect(resize).toHaveBeenCalledWith({ height: 640 });
});

it("leaves a frame that is already small alone", async () => {
  grab.mockResolvedValue({ uri: "file:///tmp/frame.jpg", width: 320, height: 240 });
  await grabPosterFrame("file:///v.mov");
  expect(resize).not.toHaveBeenCalled();
});

it("asks for the first frame when a clip is shorter than a second", async () => {
  grab.mockRejectedValueOnce(new Error("time out of range")).mockResolvedValueOnce({ uri: "file:///f.jpg", width: 10, height: 10 });
  expect(await grabPosterFrame("file:///v.mov")).toBe("file:///tmp/small.jpg");
  expect(grab.mock.calls.map((c) => c[1].time)).toEqual([1000, 0]);
});

it("uses this device's copy without touching the network", async () => {
  mockExisting.add(localPosterPath(video));
  expect(await ensurePoster(video)).toBe(localPosterPath(video));
  expect(grab).not.toHaveBeenCalled();
});

it("shares one grab between cards asking for the same video at once", async () => {
  grab.mockResolvedValue({ uri: "file:///tmp/frame.jpg", width: 100, height: 100 });
  const [a, b] = await Promise.all([ensurePoster(video), ensurePoster(video)]);
  expect(a).toBe(b);
  expect(grab).toHaveBeenCalledTimes(1);
});

it("gives up on a video the platform cannot decode, and does not retry it this session", async () => {
  grab.mockRejectedValue(new Error("unsupported codec"));
  expect(await ensurePoster(video)).toBeNull();
  const calls = grab.mock.calls.length;
  expect(await ensurePoster(video)).toBeNull();
  expect(grab.mock.calls.length).toBe(calls);
});

it("never runs more than two grabs at once", async () => {
  let live = 0;
  let peak = 0;
  grab.mockImplementation(async () => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return { uri: "file:///f.jpg", width: 10, height: 10 };
  });
  await Promise.all(["a", "b", "c", "d", "e"].map((id) => ensurePoster({ id, current_version: 1 })));
  expect(peak).toBe(2);
});

it("stores a just-uploaded video's poster from the local file, unversioned, keeping nothing", async () => {
  grab.mockResolvedValue({ uri: "file:///tmp/frame.jpg", width: 1920, height: 1080 });
  expect(await posterFromLocalVideo("f_new", "file:///staged/IMG_1.MOV")).toBe(true);
  expect(grab.mock.calls[0][0]).toBe("file:///staged/IMG_1.MOV");
  expect(grab.mock.calls[0][1].headers).toBeUndefined();
  expect((mockUploadAsync.mock.calls[0] as unknown as [string])[0]).toMatch(/\/api\/files\/f_new\/poster$/);
  expect(cachedPoster({ id: "f_new", current_version: 1 })).toBeNull();
});
