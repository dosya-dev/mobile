import { FACE_MODEL_FILES, ensureFaceModels, faceModelPaths, faceModelsReady, resetFaceModelsMemo, type ModelDeps } from "./models";

const [DET, EMB] = FACE_MODEL_FILES;

function fake(opts: { present?: string[]; hashes?: Record<string, string>; downloadFails?: boolean } = {}) {
  const files = new Map<string, string>(); // path -> sha
  for (const p of opts.present ?? []) files.set(p, "");
  const calls: string[] = [];
  const excluded: string[] = [];
  const deps: ModelDeps = {
    dir: "/d/personas-models/",
    apiBase: "https://api.test",
    exists: async (p) => files.has(p),
    download: async (url, to) => {
      calls.push(url);
      if (opts.downloadFails) throw new Error("net");
      const name = to.replace(/^.*\//, "").replace(/\.part$/, "");
      files.set(to, opts.hashes?.[name] ?? FACE_MODEL_FILES.find((f) => f.name === name)!.sha256);
    },
    remove: async (p) => void files.delete(p),
    rename: async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    sha256File: async (p) => {
      if (!files.has(p)) throw new Error("missing");
      return files.get(p)!;
    },
    excludeFromBackup: async (dir) => void excluded.push(dir),
  };
  return { deps, files, calls, excluded };
}

beforeEach(() => resetFaceModelsMemo());

describe("face models", () => {
  it("pins the two models with full hex", () => {
    expect(FACE_MODEL_FILES.map((f) => f.name)).toEqual(["yunet-2023mar-320.onnx", "sface-2021dec-f16-batch.onnx"]);
    for (const f of FACE_MODEL_FILES) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is ready when both files are present with the right hash", async () => {
    const { deps, files } = fake();
    const p = faceModelPaths(deps.dir);
    files.set(p.detector, DET.sha256);
    files.set(p.embedder, EMB.sha256);
    await expect(faceModelsReady(deps)).resolves.toBe(true);
  });

  it("is not ready when a file is missing or wrong, and false is not memoised", async () => {
    const { deps, files } = fake();
    const p = faceModelPaths(deps.dir);
    files.set(p.detector, DET.sha256);
    await expect(faceModelsReady(deps)).resolves.toBe(false);
    files.set(p.embedder, "bad");
    await expect(faceModelsReady(deps)).resolves.toBe(false);
    files.set(p.embedder, EMB.sha256);
    await expect(faceModelsReady(deps)).resolves.toBe(true);
  });

  it("memoises a true result", async () => {
    const { deps, files } = fake();
    const p = faceModelPaths(deps.dir);
    files.set(p.detector, DET.sha256);
    files.set(p.embedder, EMB.sha256);
    await faceModelsReady(deps);
    files.clear();
    await expect(faceModelsReady(deps)).resolves.toBe(true);
  });

  it("downloads what is missing, verifies, and renames from .part", async () => {
    const { deps, files, calls } = fake();
    await expect(ensureFaceModels(deps)).resolves.toBe(true);
    expect(calls).toEqual([
      `https://api.test/api/personas/models/${DET.name}?v=${DET.sha256.slice(0, 16)}`,
      `https://api.test/api/personas/models/${EMB.name}?v=${EMB.sha256.slice(0, 16)}`,
    ]);
    const p = faceModelPaths(deps.dir);
    expect([...files.keys()].sort()).toEqual([p.detector, p.embedder].sort());
  });

  it("does not download a file that is already good", async () => {
    const { deps, files, calls } = fake();
    files.set(faceModelPaths(deps.dir).detector, DET.sha256);
    await expect(ensureFaceModels(deps)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(EMB.name);
  });

  it("replaces a corrupt file", async () => {
    const { deps, files, calls } = fake();
    const p = faceModelPaths(deps.dir);
    files.set(p.detector, "corrupt");
    files.set(p.embedder, EMB.sha256);
    await expect(ensureFaceModels(deps)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(files.get(p.detector)).toBe(DET.sha256);
  });

  it("on a hash mismatch deletes the download, leaves no .part and returns false", async () => {
    const { deps, files } = fake({ hashes: { [DET.name]: "0".repeat(64) } });
    await expect(ensureFaceModels(deps)).resolves.toBe(false);
    expect([...files.keys()].filter((k) => k.endsWith(".part"))).toEqual([]);
    expect(files.has(faceModelPaths(deps.dir).detector)).toBe(false);
  });

  it("on a failed download leaves no .part and returns false", async () => {
    const { deps, files } = fake({ downloadFails: true });
    await expect(ensureFaceModels(deps)).resolves.toBe(false);
    expect(files.size).toBe(0);
  });
});

describe("backups", () => {
  it("the models folder is kept out of backups once the models are ready, also for files already on the phone", async () => {
    const { deps, files, excluded } = fake();
    const p = faceModelPaths(deps.dir);
    await faceModelsReady(deps);
    expect(excluded).toEqual([]);
    files.set(p.detector, DET.sha256);
    files.set(p.embedder, EMB.sha256);
    await expect(faceModelsReady(deps)).resolves.toBe(true);
    expect(excluded).toEqual(["/d/personas-models/"]);
  });

  it("after a download too, and a failing flag does not fail the models", async () => {
    const { deps, excluded } = fake();
    await expect(ensureFaceModels(deps)).resolves.toBe(true);
    expect(excluded).toEqual(["/d/personas-models/"]);
    resetFaceModelsMemo();
    await expect(ensureFaceModels({ ...deps, excludeFromBackup: async () => { throw new Error("no"); } })).resolves.toBe(true);
  });
});
