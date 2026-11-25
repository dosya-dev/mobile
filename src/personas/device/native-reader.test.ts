import { ReaderUnsupportedError } from "@dosya-dev/personas-engine";
import * as native from "../../../modules/dosya-face-reader";
import { PersonasUnavailableError } from "./errors";
import { FACE_MODEL_FILES, faceModelPaths, resetFaceModelsMemo, type ModelDeps } from "./models";
import { createNativeReader } from "./native-reader";

jest.mock("../../../modules/dosya-face-reader");

const m = native as jest.Mocked<typeof native>;
const W = 640;
const H = 320;

function readyDeps(present = true): ModelDeps {
  const dir = "/d/personas-models/";
  const p = faceModelPaths(dir);
  const hashes = new Map([[p.detector, FACE_MODEL_FILES[0].sha256], [p.embedder, FACE_MODEL_FILES[1].sha256]]);
  return {
    dir,
    apiBase: "https://api.test",
    exists: async () => present,
    download: async () => undefined,
    remove: async () => undefined,
    rename: async () => undefined,
    sha256File: async (x) => hashes.get(x) ?? "",
  };
}

/** One face on the stride-32 grid, cell 45, like pipeline.test.ts. */
function yunetOutputs(): Record<string, Float32Array> {
  const outs: Record<string, Float32Array> = {};
  for (const st of [8, 16, 32]) {
    const c = (320 / st) ** 2;
    outs[`cls_${st}`] = new Float32Array(c);
    outs[`obj_${st}`] = new Float32Array(c);
    outs[`bbox_${st}`] = new Float32Array(c * 4);
    outs[`kps_${st}`] = new Float32Array(c * 10);
  }
  outs.cls_32[45] = 0.95;
  outs.obj_32[45] = 0.95;
  outs.bbox_32.set([0.5, 0.5, Math.log(3), Math.log(3)], 45 * 4);
  return outs;
}

beforeEach(() => {
  resetFaceModelsMemo();
  jest.clearAllMocks();
  m.decodeImage.mockResolvedValue({ width: W, height: H, rgba: new Uint8Array(W * H * 4) });
  m.detect.mockImplementation(async () => yunetOutputs());
  m.embed.mockImplementation(async (_i, n) => Float32Array.from({ length: 128 * n }, (_, i) => (i % 128) + 1));
  m.loadModels.mockResolvedValue(undefined);
});

describe("createNativeReader", () => {
  it("returns boxes as fractions of the decoded (= encoded) size, with a 128-float unit signature", async () => {
    const faces = await createNativeReader({ models: readyDeps() }).read(new Uint8Array([1]));
    expect(faces).toHaveLength(1);
    const { box, sig, score } = faces[0];
    // Cell (4,5) at stride 32 with a 3-cell box is a 96px box centred on (176,144) in the 320 letterbox
    // (photo 640x320: scale 0.5), so 192 wide at (256,192) in the photo; the box runs past the 160px letterboxed image bottom and is clipped to 128 high.
    expect(box.x).toBeCloseTo(256 / W, 5);
    expect(box.y).toBeCloseTo(192 / H, 5);
    expect(box.w).toBeCloseTo(192 / W, 5);
    expect(box.h).toBeCloseTo(128 / H, 5);
    expect(score).toBeCloseTo(0.95, 5);
    expect(sig).toBeInstanceOf(Float32Array);
    expect(sig).toHaveLength(128);
    expect(Math.hypot(...Array.from(sig))).toBeCloseTo(1, 5);
  });

  it("maps UNSUPPORTED to ReaderUnsupportedError, FAILED to a plain Error, NO_MODELS and EUNAVAILABLE to PersonasUnavailableError", async () => {
    const reader = createNativeReader({ models: readyDeps() });
    m.decodeImage.mockRejectedValueOnce(new native.FaceReaderError("UNSUPPORTED", "too big"));
    await expect(reader.read(new Uint8Array(1))).rejects.toBeInstanceOf(ReaderUnsupportedError);
    m.decodeImage.mockRejectedValueOnce(new native.FaceReaderError("FAILED", "bad bytes"));
    const failed = await reader.read(new Uint8Array(1)).catch((e) => e);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(PersonasUnavailableError);
    expect(failed).not.toBeInstanceOf(ReaderUnsupportedError);
    m.detect.mockRejectedValueOnce(new native.FaceReaderError("NO_MODELS", "x"));
    await expect(reader.read(new Uint8Array(1))).rejects.toBeInstanceOf(PersonasUnavailableError);
    m.decodeImage.mockRejectedValueOnce(new native.FaceReaderError("EUNAVAILABLE", "x"));
    await expect(reader.read(new Uint8Array(1))).rejects.toBeInstanceOf(PersonasUnavailableError);
  });

  it("throws PersonasUnavailableError when the models are not on disk", async () => {
    await expect(createNativeReader({ models: readyDeps(false) }).read(new Uint8Array(1))).rejects.toBeInstanceOf(PersonasUnavailableError);
    expect(m.loadModels).not.toHaveBeenCalled();
  });

  it("loads the models once across reads, with plain paths", async () => {
    const reader = createNativeReader({ models: readyDeps() });
    await reader.read(new Uint8Array(1));
    await reader.read(new Uint8Array(1));
    expect(m.loadModels).toHaveBeenCalledTimes(1);
    expect(m.loadModels).toHaveBeenCalledWith("/d/personas-models/yunet-2023mar-320.onnx", "/d/personas-models/sface-2021dec-f16-batch.onnx");
  });

  it("unload releases the sessions and the next read loads them again", async () => {
    const reader = createNativeReader({ models: readyDeps() });
    await reader.read(new Uint8Array(1));
    await reader.unload();
    expect(m.unloadModels).toHaveBeenCalledTimes(1);
    await reader.read(new Uint8Array(1));
    expect(m.loadModels).toHaveBeenCalledTimes(2);
  });

  it("unload during a load waits for the load, then unloads, and the next read loads again", async () => {
    const order: string[] = [];
    let finish!: () => void;
    m.loadModels.mockImplementationOnce(() => new Promise<void>((r) => { finish = () => { order.push("loaded"); r(); }; }));
    m.unloadModels.mockImplementation(async () => { order.push("unloaded"); });
    const reader = createNativeReader({ models: readyDeps() });
    const read = reader.read(new Uint8Array(1));
    await new Promise((r) => setTimeout(r, 20));
    const unload = reader.unload();
    await new Promise((r) => setTimeout(r, 20));
    expect(m.unloadModels).not.toHaveBeenCalled();
    finish();
    await read;
    await unload;
    expect(order).toEqual(["loaded", "unloaded"]);
    await reader.read(new Uint8Array(1));
    expect(m.loadModels).toHaveBeenCalledTimes(2);
  });
});
