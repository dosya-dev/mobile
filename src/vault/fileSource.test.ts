import { mkdtempSync, writeFileSync, rmSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chunkBoundaries as tsChunkBoundaries, chunkerVectorBytes } from "@dosya-dev/e2ee-core";
jest.mock("../../modules/dosya-vault-chunker");
import { fileSourceFromUri, type OpenReader } from "./fileSource";

const nodeReader: OpenReader = async (uri) => {
  const path = fileURLToPath(uri);
  const fd = openSync(path, "r");
  return {
    size: statSync(path).size,
    async read(offset, length) { const b = new Uint8Array(length); const n = readSync(fd, b, 0, length, offset); return b.subarray(0, n); },
    close() { closeSync(fd); },
  };
};

describe("fileSourceFromUri", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "vault-src-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("yields the native boundaries and reads exactly each chunk's bytes", async () => {
    const bytes = chunkerVectorBytes(4 * 1024 * 1024 + 1);
    const p = join(dir, "v.bin"); writeFileSync(p, bytes);
    const src = await fileSourceFromUri(pathToFileURL(p).href, { openReader: nodeReader });
    expect(src.totalSize).toBe(bytes.length);
    expect(src.boundaries).toEqual(tsChunkBoundaries(bytes));
    for (const b of src.boundaries) {
      const got = await src.read(b.offset, b.size);
      expect(Buffer.from(got).equals(Buffer.from(bytes.subarray(b.offset, b.offset + b.size)))).toBe(true);
    }
    src.close();
  });

  it("a short read throws instead of returning fewer bytes", async () => {
    const p = join(dir, "s.bin"); writeFileSync(p, new Uint8Array(10));
    const lying: OpenReader = async (uri) => { const r = await nodeReader(uri); return { ...r, read: async (o, l) => (await r.read(o, l)).subarray(0, l - 1) }; };
    const src = await fileSourceFromUri(pathToFileURL(p).href, { openReader: lying });
    await expect(src.read(0, 10)).rejects.toThrow("vault: short read");
    src.close();
  });

  it("refuses a non-file URI, and an empty file yields no boundaries", async () => {
    await expect(fileSourceFromUri("content://x", { openReader: nodeReader })).rejects.toMatchObject({ code: "EINVAL" });
    const p = join(dir, "e.bin"); writeFileSync(p, new Uint8Array(0));
    const src = await fileSourceFromUri(pathToFileURL(p).href, { openReader: nodeReader });
    expect(src.totalSize).toBe(0);
    expect(src.boundaries).toEqual([]);
    src.close();
  });

  it("a malformed percent-escape in the URI rejects as EINVAL instead of a bare URIError", async () => {
    await expect(fileSourceFromUri("file:///a%", { openReader: nodeReader })).rejects.toMatchObject({ code: "EINVAL" });
  });

  it("close() is idempotent: a second call does not throw", async () => {
    const p = join(dir, "c.bin"); writeFileSync(p, new Uint8Array(3));
    const src = await fileSourceFromUri(pathToFileURL(p).href, { openReader: nodeReader });
    src.close();
    expect(() => src.close()).not.toThrow();
  });
});
