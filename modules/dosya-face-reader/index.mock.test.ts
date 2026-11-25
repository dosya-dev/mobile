// The manual mock in __mocks__ (what other modules' tests get from jest.mock).
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("./index");
import * as m from "./index";

describe("dosya-face-reader manual mock", () => {
  it("hashes a real file and exposes the real error class", async () => {
    const dir = mkdtempSync(join(tmpdir(), "face-reader-"));
    try {
      const p = join(dir, "f.bin");
      writeFileSync(p, "abc");
      expect(m.isNativeFaceReaderAvailable()).toBe(true);
      await expect(m.sha256File(p)).resolves.toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
      await expect(m.sha256File(join(dir, "nope"))).rejects.toMatchObject({ code: "FAILED" });
      expect((await m.decodeImage(new Uint8Array(1))).width).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
