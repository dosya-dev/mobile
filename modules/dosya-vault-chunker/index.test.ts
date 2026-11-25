import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chunkerVectorBytes, CHUNKER_VECTORS, CHUNKER_GEAR_SHA256_HEX } from "@dosya-dev/e2ee-core";

jest.mock("./index");
import { chunkBoundaries, gearTableSha256Hex, isNativeChunkerAvailable, ChunkerError, DEFAULT_CHUNK_PARAMS } from "./index";

describe("dosya-vault-chunker wrapper (jest manual mock = the TypeScript chunker over a real file)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "vault-chunker-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reproduces the frozen vectors up to 10 MiB from files on disk", async () => {
    for (const v of CHUNKER_VECTORS.filter((x) => x.size <= 10 * 1024 * 1024)) {
      const p = join(dir, `v-${v.size}.bin`);
      writeFileSync(p, chunkerVectorBytes(v.size));
      // The size rides along in the compared value so a failure names the
      // vector (jest's expect takes no message argument, unlike vitest's).
      const boundaries = await chunkBoundaries(pathToFileURL(p).href);
      expect({ size: v.size, boundaries }).toEqual({ size: v.size, boundaries: v.boundaries });
    }
  });

  it("exposes the gear-table hash the native ports are checked against", () => {
    expect(isNativeChunkerAvailable()).toBe(true);
    expect(gearTableSha256Hex()).toBe(CHUNKER_GEAR_SHA256_HEX);
    expect(DEFAULT_CHUNK_PARAMS).toEqual({ min: 256 * 1024, avg: 1024 * 1024, max: 4 * 1024 * 1024 });
  });

  it("refuses anything but a file:// URI before reaching native code", async () => {
    for (const bad of ["content://media/external/images/1", "https://example.com/x", "/absolute/path", ""]) {
      await expect(chunkBoundaries(bad)).rejects.toMatchObject({ code: "EINVAL" });
      await expect(chunkBoundaries(bad)).rejects.toBeInstanceOf(ChunkerError);
    }
  });

  it("maps a missing file to ENOENT", async () => {
    await expect(chunkBoundaries(pathToFileURL(join(dir, "nope.bin")).href)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
