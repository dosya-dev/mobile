// The real download path of ensureFaceModels (default deps over expo-file-system).
import * as FileSystem from "expo-file-system/legacy";
import { FACE_MODEL_FILES, ensureFaceModels, resetFaceModelsMemo } from "./models";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  // Same values as expo-file-system's enum.
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(async () => {}),
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
}));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("../../../modules/dosya-face-reader", () => ({
  // Every file hashes to its own pin, so each model downloads once and is accepted.
  sha256File: jest.fn(async (p: string) => {
    const { FACE_MODEL_FILES: files } = jest.requireActual<typeof import("./models")>("./models");
    return files.find((f) => p.includes(f.name))!.sha256;
  }),
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const present = new Set<string>();

beforeEach(() => {
  resetFaceModelsMemo();
  present.clear();
  jest.clearAllMocks();
  fs.getInfoAsync.mockImplementation(async (p: string) => ({ exists: present.has(p) }) as FileSystem.FileInfo);
  fs.moveAsync.mockImplementation(async ({ to }: { from: string; to: string }) => void present.add(to));
  fs.downloadAsync.mockImplementation(async () => ({ status: 200 }) as FileSystem.FileSystemDownloadResult);
});

describe("ensureFaceModels download", () => {
  it("downloads in a foreground session (a background URLSession fails on the iOS simulator)", async () => {
    expect(await ensureFaceModels()).toBe(true);
    expect(fs.downloadAsync).toHaveBeenCalledTimes(2);
    for (const [i, f] of FACE_MODEL_FILES.entries()) {
      expect(fs.downloadAsync.mock.calls[i]).toEqual([
        `https://api.test/api/personas/models/${f.name}?v=${f.sha256.slice(0, 16)}`,
        `file:///docs/personas-models/${f.name}.part`,
        { sessionType: FileSystem.FileSystemSessionType.FOREGROUND },
      ]);
    }
  });

  it("fails on a non-200 response", async () => {
    fs.downloadAsync.mockImplementation(async () => ({ status: 404 }) as FileSystem.FileSystemDownloadResult);
    expect(await ensureFaceModels()).toBe(false);
  });
});
