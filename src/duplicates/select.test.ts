import {
  allButNewest, chunk, fullySelectedGroups, selectedBytes, selectedCount,
  toggle, DELETE_CHUNK, type DuplicateGroup,
} from "./select";

function g(hash: string, size: number, ids: string[]): DuplicateGroup {
  return {
    content_hash: hash,
    size_bytes: size,
    count: ids.length,
    wasted_bytes: (ids.length - 1) * size,
    files: ids.map((id, i) => ({
      id, name: `${hash}.png`, folder_id: null, folder_path: "Root",
      created_at: 1_700_000_000 - i, uploaded_by: "u1", uploader_name: "Ada",
      mime_type: "image/png", extension: ".png",
    })),
  };
}

const GROUPS = [g("a", 100, ["a1", "a2", "a3"]), g("b", 50, ["b1", "b2"])];

describe("allButNewest", () => {
  it("leaves exactly one copy per group", () => {
    // Files arrive newest-first, so index 0 is the keeper. Getting this
    // backwards would delete the copy the user most likely wants.
    expect(allButNewest(GROUPS)).toEqual(["a2", "a3", "b2"]);
  });

  it("selects nothing when there are no groups", () => {
    expect(allButNewest([])).toEqual([]);
  });
});

describe("toggle", () => {
  it("adds then removes an id without mutating the input", () => {
    const empty = new Set<string>();
    const added = toggle(empty, "a1");
    expect(added.has("a1")).toBe(true);
    expect(empty.has("a1")).toBe(false);
    expect(toggle(added, "a1").has("a1")).toBe(false);
  });
});

describe("fullySelectedGroups", () => {
  it("counts a group with every copy selected", () => {
    expect(fullySelectedGroups(GROUPS, new Set(["b1", "b2"]))).toBe(1);
  });

  it("counts nothing when one copy survives", () => {
    expect(fullySelectedGroups(GROUPS, new Set(["b2"]))).toBe(0);
  });

  it("counts both when everything is selected", () => {
    expect(fullySelectedGroups(GROUPS, new Set(["a1", "a2", "a3", "b1", "b2"]))).toBe(2);
  });

  it("does not count an empty group as fully selected", () => {
    const empty: DuplicateGroup = { ...g("c", 10, []), files: [] };
    expect(fullySelectedGroups([empty], new Set())).toBe(0);
  });
});

describe("selectedBytes", () => {
  it("weighs each selected copy at its group's size", () => {
    expect(selectedBytes(GROUPS, new Set(["a2", "a3"]))).toBe(200);
    expect(selectedBytes(GROUPS, new Set(["a2", "b2"]))).toBe(150);
  });

  it("is zero for an empty selection", () => {
    expect(selectedBytes(GROUPS, new Set())).toBe(0);
  });
});

describe("selectedCount", () => {
  it("counts only ids that are still in the groups", () => {
    // A refetch can drop a file that was selected before it was deleted
    // elsewhere; a stale id must not inflate the count the confirm dialog shows.
    expect(selectedCount(GROUPS, new Set(["a2", "gone"]))).toBe(1);
  });
});

describe("chunk", () => {
  it("splits at the API's 500-id cap", () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `f${i}`);
    const out = chunk(ids);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(DELETE_CHUNK);
    expect(out[2]).toHaveLength(1);
  });

  it("returns one chunk for a small selection", () => {
    expect(chunk(["a", "b"])).toEqual([["a", "b"]]);
  });

  it("returns nothing for an empty selection", () => {
    expect(chunk([])).toEqual([]);
  });
});
