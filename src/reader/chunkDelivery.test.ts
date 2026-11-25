import { chunkOffsets, deliverBook, CHUNK_BYTES } from "./chunkDelivery";

describe("chunkOffsets", () => {
  it("handles zero and sub-chunk sizes", () => {
    expect(chunkOffsets(0)).toEqual([]);
    expect(chunkOffsets(10, 4)).toEqual([
      { position: 0, length: 4 }, { position: 4, length: 4 }, { position: 8, length: 2 },
    ]);
  });
  it("handles exact multiples", () => {
    expect(chunkOffsets(8, 4)).toEqual([{ position: 0, length: 4 }, { position: 4, length: 4 }]);
  });
  it("defaults to 2MB chunks", () => {
    expect(CHUNK_BYTES).toBe(2 * 1024 * 1024);
    expect(chunkOffsets(CHUNK_BYTES + 1)).toHaveLength(2);
  });
});

describe("deliverBook", () => {
  it("injects chunks in order then open, reporting progress", async () => {
    const injected: string[] = [];
    const fractions: number[] = [];
    await deliverBook({
      uri: "file:///b.epub",
      size: 10,
      chunk: 4,
      inject: (js) => injected.push(js),
      readChunk: async (_uri, position, length) => `b64:${position}:${length}`,
      onProgress: (f) => fractions.push(f),
    });
    expect(injected).toHaveLength(4);
    expect(injected[0]).toContain("b64:0:4");
    expect(injected[1]).toContain("b64:4:4");
    expect(injected[2]).toContain("b64:8:2");
    expect(injected[3]).toBe("window.__dosyaOpen();true;");
    expect(fractions[fractions.length - 1]).toBe(1);
  });
});
