// The wrapper is tested against a fake native module injected through
// expo-modules-core. The manual mock is checked in index.mock.test.ts.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Wrapper = typeof import("./index");

function load(native: unknown): Wrapper {
  let mod!: Wrapper;
  jest.isolateModules(() => {
    jest.doMock("expo-modules-core", () => ({ requireOptionalNativeModule: () => native }));
    mod = require("./index");
  });
  return mod;
}

const nativeError = (code: string) => Object.assign(new Error(`native ${code}`), { code });

describe("dosya-face-reader wrapper", () => {
  it("reports EUNAVAILABLE when the native module is missing", async () => {
    const w = load(null);
    expect(w.isNativeFaceReaderAvailable()).toBe(false);
    await expect(w.decodeImage(new Uint8Array(4))).rejects.toMatchObject({ code: "EUNAVAILABLE" });
    await expect(w.sha256File("/x")).rejects.toMatchObject({ code: "EUNAVAILABLE" });
    await expect(w.sha256File("/x")).rejects.toBeInstanceOf(w.FaceReaderError);
  });

  it("maps ERR_UNSUPPORTED to UNSUPPORTED", async () => {
    const w = load({ decode: jest.fn().mockRejectedValue(nativeError("ERR_UNSUPPORTED")), sha256File: jest.fn() });
    await expect(w.decodeImage(new Uint8Array(4))).rejects.toMatchObject({ code: "UNSUPPORTED", name: "FaceReaderError" });
  });

  it("maps ERR_FAILED and unknown errors to FAILED", async () => {
    const w = load({ decode: jest.fn().mockRejectedValue(nativeError("ERR_FAILED")), sha256File: jest.fn().mockRejectedValue(new Error("boom")) });
    await expect(w.decodeImage(new Uint8Array(4))).rejects.toMatchObject({ code: "FAILED" });
    await expect(w.sha256File("/x")).rejects.toMatchObject({ code: "FAILED", message: "boom" });
  });

  it("passes 1600 and 36,000,000 to native and returns its pixels", async () => {
    const out = { width: 2, height: 1, rgba: new Uint8Array(8) };
    const decode = jest.fn().mockResolvedValue(out);
    const w = load({ decode, sha256File: jest.fn() });
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(w.decodeImage(bytes)).resolves.toBe(out);
    expect(decode).toHaveBeenCalledWith(bytes, 1600, 36_000_000);
  });

  it("lowercases the file hash", async () => {
    const w = load({ decode: jest.fn(), sha256File: jest.fn().mockResolvedValue("ABCDEF0123") });
    await expect(w.sha256File("/a/b")).resolves.toBe("abcdef0123");
  });

  describe("ONNX sessions", () => {
    const names = ["cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"];
    const bytesOf = (f: Float32Array) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    const fake = (over: Record<string, unknown> = {}) => ({
      decode: jest.fn(), sha256File: jest.fn(),
      loadModels: jest.fn().mockResolvedValue(undefined),
      detect: jest.fn(), embed: jest.fn(), unloadModels: jest.fn().mockResolvedValue(undefined),
      ...over,
    });

    it("rejects NO_MODELS before load, and maps native ERR_NO_MODELS", async () => {
      const n = fake({ detect: jest.fn().mockRejectedValue(nativeError("ERR_NO_MODELS")), embed: jest.fn().mockRejectedValue(nativeError("ERR_NO_MODELS")) });
      const w = load(n);
      await expect(w.detect(new Float32Array(307200))).rejects.toMatchObject({ code: "NO_MODELS" });
      await expect(w.embed(new Float32Array(37632), 1)).rejects.toMatchObject({ code: "NO_MODELS" });
    });

    it("loadModels forwards the paths and maps failures to FAILED", async () => {
      const n = fake();
      const w = load(n);
      await w.loadModels("/a.onnx", "/b.onnx");
      expect(n.loadModels).toHaveBeenCalledWith("/a.onnx", "/b.onnx");
      n.loadModels.mockRejectedValueOnce(nativeError("ERR_FAILED"));
      await expect(w.loadModels("/a.onnx", "/b.onnx")).rejects.toMatchObject({ code: "FAILED" });
    });

    it("checks input length in JS without calling native", async () => {
      const n = fake();
      const w = load(n);
      await expect(w.detect(new Float32Array(10))).rejects.toMatchObject({ code: "FAILED" });
      await expect(w.embed(new Float32Array(37632), 2)).rejects.toMatchObject({ code: "FAILED" });
      await expect(w.embed(new Float32Array(0), 0)).rejects.toMatchObject({ code: "FAILED" });
      await expect(w.embed(new Float32Array(37632), 1.5)).rejects.toMatchObject({ code: "FAILED" });
      expect(n.detect).not.toHaveBeenCalled();
      expect(n.embed).not.toHaveBeenCalled();
    });

    it("passes detect outputs through as Float32Arrays", async () => {
      const outs: Record<string, Uint8Array> = {};
      names.forEach((k, i) => { outs[k] = bytesOf(new Float32Array([i, i + 0.5])); });
      const n = fake({ detect: jest.fn().mockResolvedValue(outs) });
      const w = load(n);
      const input = new Float32Array(307200);
      const r = await w.detect(input);
      expect(Object.keys(r)).toEqual(names);
      expect(r.bbox_16).toBeInstanceOf(Float32Array);
      expect(Array.from(r.kps_32)).toEqual([11, 11.5]);
      expect(n.detect.mock.calls[0][0]).toHaveLength(307200 * 4);
    });

    it("embed returns n*128 floats", async () => {
      const out = new Float32Array(256).fill(0.25);
      const n = fake({ embed: jest.fn().mockResolvedValue(bytesOf(out)) });
      const w = load(n);
      const r = await w.embed(new Float32Array(37632 * 2), 2);
      expect(r).toBeInstanceOf(Float32Array);
      expect(r).toHaveLength(256);
      expect(n.embed.mock.calls[0][1]).toBe(2);
    });

    it("rejects an embed result of the wrong size", async () => {
      const w = load(fake({ embed: jest.fn().mockResolvedValue(new Uint8Array(8)) }));
      await expect(w.embed(new Float32Array(37632), 1)).rejects.toMatchObject({ code: "FAILED" });
    });

    it("unloadModels reaches native", async () => {
      const n = fake();
      const w = load(n);
      await w.unloadModels();
      expect(n.unloadModels).toHaveBeenCalled();
    });
  });
});
