import { sourceTimeHeaders } from "./sourceTime";

describe("sourceTimeHeaders", () => {
  it("declares both original dates when the item carries them", () => {
    expect(sourceTimeHeaders({ sourceCreatedAt: 1_500_000_000, sourceModifiedAt: 1_600_000_000 })).toEqual({
      "X-Dosya-Source-Ctime": "1500000000",
      "X-Dosya-Source-Mtime": "1600000000",
    });
  });

  it("sends only what the item has", () => {
    expect(sourceTimeHeaders({ sourceCreatedAt: 1_500_000_000 })).toEqual({
      "X-Dosya-Source-Ctime": "1500000000",
    });
    expect(sourceTimeHeaders({})).toEqual({});
  });

  it("skips zero and negative epoch fallbacks", () => {
    expect(sourceTimeHeaders({ sourceCreatedAt: 0, sourceModifiedAt: -5 })).toEqual({});
  });
});
