import { AUDIO_URL_TTL_SECONDS, resolveTrackUrl } from "./resolver";
import { getCachedUri } from "./cache";
import { getDownloadUrl } from "@/files/api";
import type { PlayerTrack } from "./types";

jest.mock("./cache", () => ({ getCachedUri: jest.fn() }));
jest.mock("@/files/api", () => ({ getDownloadUrl: jest.fn() }));

const t: PlayerTrack = { fileId: "a1", title: "one", artist: "Mix", extension: "mp3", sizeBytes: 1000, modifiedAt: 5 };

afterEach(() => jest.clearAllMocks());

describe("resolveTrackUrl", () => {
  it("prefers the cache and never presigns for a hit", async () => {
    (getCachedUri as jest.Mock).mockResolvedValue("file:///cache/audio-cache/a1.mp3");
    expect(await resolveTrackUrl(t)).toEqual({ url: "file:///cache/audio-cache/a1.mp3", fromCache: true });
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("presigns with the hour-long audio ttl on a miss", async () => {
    (getCachedUri as jest.Mock).mockResolvedValue(null);
    (getDownloadUrl as jest.Mock).mockResolvedValue("https://r2/a1");
    expect(await resolveTrackUrl(t)).toEqual({ url: "https://r2/a1", fromCache: false });
    expect(getDownloadUrl).toHaveBeenCalledWith("a1", undefined, AUDIO_URL_TTL_SECONDS);
    expect(AUDIO_URL_TTL_SECONDS).toBe(3600);
  });

  it("propagates presign failure (offline, uncached) to the caller", async () => {
    (getCachedUri as jest.Mock).mockResolvedValue(null);
    (getDownloadUrl as jest.Mock).mockRejectedValue(new Error("Network request failed"));
    await expect(resolveTrackUrl(t)).rejects.toThrow("Network request failed");
  });
});
