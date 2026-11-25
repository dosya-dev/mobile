jest.mock("expo-file-system", () => ({ Paths: { cache: { uri: "file:///cache/" } }, File: class {}, Directory: class {} }));
import { cachePathFor, createCacheSink, cachedFile, wipeVaultCache, vaultCacheDir, type CacheFs } from "./cache";

function memFs() {
  const files = new Map<string, Uint8Array[]>();
  const fs: CacheFs = {
    async ensureDir() {},
    async open(p) { files.set(p, []); return { async write(b) { files.get(p)!.push(b); }, async close() {} }; },
    async rename(a, b) { files.set(b, files.get(a)!); files.delete(a); },
    async remove(p) { files.delete(p); },
    async exists(p) { const f = files.get(p); return { exists: !!f, size: f ? f.reduce((n, b) => n + b.length, 0) : 0 }; },
    async removeTree(d) { for (const k of [...files.keys()]) if (k.startsWith(d)) files.delete(k); },
  };
  return { fs, files };
}

describe("cachePathFor", () => {
  it("never uses the entry name raw as a path component", () => {
    const t = cachePathFor("ws-1", "f-1", 3, "../evil/../../x.txt");
    expect(t.dir).toBe(`${vaultCacheDir()}/ws-1/f-1-v3`);
    expect(t.fileName).toBe("x.txt");
    expect(cachePathFor("ws", "f", 1, ".hidden").fileName).toBe("hidden");
    expect(cachePathFor("ws", "f", 1, "a/b/c.png").fileName).toBe("c.png");
    const longName = cachePathFor("ws", "f", 1, "x".repeat(300) + ".pdf").fileName;
    expect(longName.length).toBeLessThanOrEqual(120);
    expect(longName.endsWith(".pdf")).toBe(true);
    expect(cachePathFor("ws", "f", 1, "").fileName).toBe("file");
    expect(vaultCacheDir()).toBe("file:///cache/vault");
  });

  it("never uses workspaceId or fileId raw as a path component either", () => {
    const t = cachePathFor("../../evil", "../x", 1, "a.jpg");
    expect(t.dir.startsWith(`${vaultCacheDir()}/`)).toBe(true);
    expect(t.dir.split("/")).not.toContain("..");
  });
});

describe("createCacheSink", () => {
  it("writes chunks to a .part file and renames on finish; cachedFile then finds it", async () => {
    const { fs, files } = memFs();
    const target = cachePathFor("ws-1", "f-1", 1, "a.jpg");
    const { sink, finish } = createCacheSink(target, fs);
    await sink(new Uint8Array([1, 2]), 0);
    await sink(new Uint8Array([3]), 1);
    expect([...files.keys()]).toEqual([`${target.dir}/a.jpg.part`]);
    const uri = await finish();
    expect(uri).toBe(`${target.dir}/a.jpg`);
    expect([...files.keys()]).toEqual([`${target.dir}/a.jpg`]);
    expect(await cachedFile(target, fs)).toBe(uri);
  });

  it("abort removes the .part file; cachedFile ignores an empty file", async () => {
    const { fs, files } = memFs();
    const target = cachePathFor("ws-1", "f-2", 1, "b.bin");
    const { sink, abort } = createCacheSink(target, fs);
    await sink(new Uint8Array([9]), 0);
    await abort();
    expect(files.size).toBe(0);
    const empty = createCacheSink(cachePathFor("ws-1", "f-3", 1, "c.bin"), fs);
    await empty.finish();
    expect(await cachedFile(cachePathFor("ws-1", "f-3", 1, "c.bin"), fs)).toBeNull();
  });

  it("wipeVaultCache removes everything under the vault directory, .part files included", async () => {
    const { fs, files } = memFs();
    const { sink } = createCacheSink(cachePathFor("ws-1", "f-1", 1, "a.jpg"), fs);
    await sink(new Uint8Array([1]), 0);
    await wipeVaultCache(fs);
    expect(files.size).toBe(0);
  });

  it("abort after finish is a no-op and leaves the final file intact", async () => {
    const { fs, files } = memFs();
    const target = cachePathFor("ws-1", "f-1", 1, "a.jpg");
    const { sink, finish, abort } = createCacheSink(target, fs);
    await sink(new Uint8Array([1]), 0);
    const uri = await finish();
    await abort();
    expect([...files.keys()]).toEqual([`${target.dir}/a.jpg`]);
    expect(await cachedFile(target, fs)).toBe(uri);
  });

  it("finish is idempotent: a second call returns the same path without touching the fs again", async () => {
    const { fs, files } = memFs();
    const target = cachePathFor("ws-1", "f-1", 1, "a.jpg");
    const { sink, finish } = createCacheSink(target, fs);
    await sink(new Uint8Array([1]), 0);
    const first = await finish();
    const second = await finish();
    expect(second).toBe(first);
    expect([...files.keys()]).toEqual([`${target.dir}/a.jpg`]);
  });

  it("sink() after finish() throws instead of writing to a closed handle", async () => {
    const { fs } = memFs();
    const target = cachePathFor("ws-1", "f-1", 1, "a.jpg");
    const { sink, finish } = createCacheSink(target, fs);
    await sink(new Uint8Array([1]), 0);
    await finish();
    await expect(sink(new Uint8Array([2]), 1)).rejects.toThrow("vault: sink closed");
  });

  it("sink() after abort() throws instead of writing to a removed .part file", async () => {
    const { fs } = memFs();
    const target = cachePathFor("ws-1", "f-1", 1, "a.jpg");
    const { sink, abort } = createCacheSink(target, fs);
    await sink(new Uint8Array([1]), 0);
    await abort();
    await expect(sink(new Uint8Array([2]), 1)).rejects.toThrow("vault: sink closed");
  });

  it("abort on a never-opened sink does not throw", async () => {
    const { fs, files } = memFs();
    const { abort } = createCacheSink(cachePathFor("ws-1", "f-4", 1, "d.bin"), fs);
    await expect(abort()).resolves.toBeUndefined();
    expect(files.size).toBe(0);
  });

  it("a failed rename removes the .part file instead of leaving plaintext behind", async () => {
    const { fs, files } = memFs();
    const target = cachePathFor("ws-1", "f-1", 1, "a.jpg");
    const failingFs: CacheFs = { ...fs, async rename() { throw new Error("disk full"); } };
    const { sink, finish } = createCacheSink(target, failingFs);
    await sink(new Uint8Array([1]), 0);
    await expect(finish()).rejects.toThrow("disk full");
    expect(files.size).toBe(0);
  });
});
